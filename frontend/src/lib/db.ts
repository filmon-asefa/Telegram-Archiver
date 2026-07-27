import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";

const DB_PATH = path.resolve(
  process.env.ARCHIVER_DB_PATH ||
    path.join(process.cwd(), "..", "data", "telegram_archive.db")
);

let _db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH, { open: true, readOnly: true });
  }
  return _db;
}

export interface Chat {
  chat_id: number;
  chat_name: string;
  chat_type: string;
  last_synced_message_id: number;
  message_count: number;
  last_message_text: string | null;
  last_message_date: number | null;
}

export interface Message {
  chat_id: number;
  message_id: number;
  sender_id: number | null;
  sender_name: string | null;
  is_outgoing: number;
  date_unix: number;
  text: string | null;
  media_type: string | null;
  file_path: string | null;
}

export interface Sender {
  sender_id: number;
  sender_name: string;
  message_count: number;
}

export function queryAll<T>(sql: string, params?: (string | number | null)[]): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  const rows = params ? stmt.all(...params) : stmt.all();
  return rows as T[];
}

function queryOne<T>(sql: string, params?: (string | number | null)[]): T | undefined {
  const db = getDb();
  const stmt = db.prepare(sql);
  const row = params ? stmt.get(...params) : stmt.get();
  return row as T | undefined;
}

export function getChats(search?: string): Chat[] {
  if (search) {
    return queryAll<Chat>(
      `SELECT c.chat_id, c.chat_name, c.chat_type, c.last_synced_message_id,
       (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.chat_id) AS message_count,
       (SELECT text FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.date_unix DESC LIMIT 1) AS last_message_text,
       (SELECT date_unix FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.date_unix DESC LIMIT 1) AS last_message_date
       FROM chats c WHERE c.chat_name LIKE ? ORDER BY last_message_date DESC`,
      [`%${search}%`]
    );
  }
  return queryAll<Chat>(
    `SELECT c.chat_id, c.chat_name, c.chat_type, c.last_synced_message_id,
     (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.chat_id) AS message_count,
     (SELECT text FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.date_unix DESC LIMIT 1) AS last_message_text,
     (SELECT date_unix FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.date_unix DESC LIMIT 1) AS last_message_date
     FROM chats c ORDER BY last_message_date DESC`
  );
}

export function getChat(chatId: number): Chat | undefined {
  return queryOne<Chat>(
    `SELECT c.chat_id, c.chat_name, c.chat_type, c.last_synced_message_id,
     (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.chat_id) AS message_count,
     (SELECT text FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.date_unix DESC LIMIT 1) AS last_message_text,
     (SELECT date_unix FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.date_unix DESC LIMIT 1) AS last_message_date
     FROM chats c WHERE c.chat_id = ?`,
    [chatId]
  );
}

export function getMessages(
  chatId: number,
  limit = 50,
  before?: number
): Message[] {
  if (before) {
    return queryAll<Message>(
      `SELECT * FROM messages WHERE chat_id = ? AND message_id < ? ORDER BY message_id DESC LIMIT ?`,
      [chatId, before, limit]
    );
  }
  return queryAll<Message>(
    `SELECT * FROM messages WHERE chat_id = ? ORDER BY message_id DESC LIMIT ?`,
    [chatId, limit]
  );
}

export function getSenders(chatId: number): Sender[] {
  return queryAll<Sender>(
    `SELECT sender_id, sender_name, COUNT(*) AS message_count
     FROM messages WHERE chat_id = ? AND sender_name IS NOT NULL
     GROUP BY sender_id, sender_name ORDER BY message_count DESC`,
    [chatId]
  );
}

export function searchMessages(
  q: string,
  limit = 50,
  chatId?: number,
  senderName?: string,
  dateFrom?: number,
  dateTo?: number
): (Message & { chat_name: string })[] {
  let sql = `SELECT m.*, c.chat_name FROM messages m JOIN chats c ON c.chat_id = m.chat_id WHERE m.text LIKE ?`;
  const params: (string | number)[] = [`%${q}%`];

  if (chatId) {
    sql += ` AND m.chat_id = ?`;
    params.push(chatId);
  }
  if (senderName) {
    sql += ` AND m.sender_name LIKE ?`;
    params.push(`%${senderName}%`);
  }
  if (dateFrom) {
    sql += ` AND m.date_unix >= ?`;
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ` AND m.date_unix <= ?`;
    params.push(dateTo);
  }

  sql += ` ORDER BY m.date_unix DESC LIMIT ?`;
  params.push(limit);

  return queryAll(sql, params);
}

export function getMedia(
  chatId?: number,
  mediaType?: string,
  limit = 50,
  offset = 0
): (Message & { chat_name: string })[] {
  let sql = `SELECT m.*, c.chat_name FROM messages m JOIN chats c ON c.chat_id = m.chat_id WHERE m.file_path IS NOT NULL AND m.media_type IS NOT NULL`;
  const params: (string | number)[] = [];

  if (chatId) {
    sql += ` AND m.chat_id = ?`;
    params.push(chatId);
  }
  if (mediaType) {
    sql += ` AND m.media_type = ?`;
    params.push(mediaType);
  }

  sql += ` ORDER BY m.date_unix DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return queryAll(sql, params);
}

export function getMediaCount(chatId?: number, mediaType?: string): number {
  let sql = `SELECT COUNT(*) as cnt FROM messages m WHERE m.file_path IS NOT NULL AND m.media_type IS NOT NULL`;
  const params: (string | number)[] = [];

  if (chatId) {
    sql += ` AND m.chat_id = ?`;
    params.push(chatId);
  }
  if (mediaType) {
    sql += ` AND m.media_type = ?`;
    params.push(mediaType);
  }

  const row = queryOne<{ cnt: number }>(sql, params);
  return Number(row?.cnt ?? 0);
}

export function getChatStats(chatId: number) {
  const stats = queryOne<Record<string, number | null>>(
    `SELECT
      COUNT(*) as total_messages,
      SUM(CASE WHEN file_path IS NOT NULL THEN 1 ELSE 0 END) as total_media,
      SUM(CASE WHEN media_type = 'photos' THEN 1 ELSE 0 END) as photos,
      SUM(CASE WHEN media_type = 'videos' THEN 1 ELSE 0 END) as videos,
      SUM(CASE WHEN media_type = 'voice' THEN 1 ELSE 0 END) as voice,
      SUM(CASE WHEN media_type = 'documents' THEN 1 ELSE 0 END) as documents,
      SUM(CASE WHEN media_type = 'audio' THEN 1 ELSE 0 END) as audio,
      SUM(CASE WHEN media_type = 'stickers' THEN 1 ELSE 0 END) as stickers,
      MIN(date_unix) as first_message_date,
      MAX(date_unix) as last_message_date
    FROM messages WHERE chat_id = ?`,
    [chatId]
  );

  const editCount = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM message_edits WHERE chat_id = ?`, [chatId]
  );
  const deleteCount = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM message_deleted WHERE chat_id = ?`, [chatId]
  );

  return {
    total_messages: Number(stats?.total_messages ?? 0),
    total_media: Number(stats?.total_media ?? 0),
    photos: Number(stats?.photos ?? 0),
    videos: Number(stats?.videos ?? 0),
    voice: Number(stats?.voice ?? 0),
    documents: Number(stats?.documents ?? 0),
    audio: Number(stats?.audio ?? 0),
    stickers: Number(stats?.stickers ?? 0),
    first_message_date: stats?.first_message_date as number | null,
    last_message_date: stats?.last_message_date as number | null,
    top_senders: getSenders(chatId),
    total_edits: Number(editCount?.cnt ?? 0),
    total_deletions: Number(deleteCount?.cnt ?? 0),
  };
}

export interface MessageEdit {
  old_text: string | null;
  new_text: string | null;
  edited_at_unix: number;
}

export interface DeletedMessage {
  message_id: number;
  deleted_at_unix: number;
  old_text: string | null;
  old_sender_name: string | null;
  old_date_unix: number | null;
  old_media_type: string | null;
}

export function getMessageEdits(chatId: number, messageId: number): MessageEdit[] {
  return queryAll<MessageEdit>(
    `SELECT old_text, new_text, edited_at_unix FROM message_edits
     WHERE chat_id = ? AND message_id = ? ORDER BY edited_at_unix`,
    [chatId, messageId]
  );
}

export function getDeletedMessages(chatId: number, limit = 50): DeletedMessage[] {
  return queryAll<DeletedMessage>(
    `SELECT message_id, deleted_at_unix, old_text, old_sender_name, old_date_unix, old_media_type
     FROM message_deleted WHERE chat_id = ? ORDER BY deleted_at_unix DESC LIMIT ?`,
    [chatId, limit]
  );
}

export function getChangesSince(unix: number) {
  const edits = queryAll<{ chat_id: number; message_id: number; old_text: string | null; new_text: string | null; edited_at_unix: number }>(
    `SELECT chat_id, message_id, old_text, new_text, edited_at_unix
     FROM message_edits WHERE edited_at_unix > ? ORDER BY edited_at_unix`,
    [unix]
  );
  const deletions = queryAll<{ chat_id: number; message_id: number; deleted_at_unix: number; old_text: string | null; old_sender_name: string | null }>(
    `SELECT chat_id, message_id, deleted_at_unix, old_text, old_sender_name
     FROM message_deleted WHERE deleted_at_unix > ? ORDER BY deleted_at_unix`,
    [unix]
  );
  const newMessages = queryAll<Message>(
    `SELECT * FROM messages WHERE date_unix > ? ORDER BY date_unix ASC`,
    [unix]
  );
  return { edits, deletions, newMessages };
}
