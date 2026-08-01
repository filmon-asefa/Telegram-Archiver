import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import type {
  Chat,
  Message,
  Topic,
  Sender,
  MessageEdit,
  DeletedMessage,
  TopicFilter,
} from "./types";

export type {
  Chat,
  Message,
  Topic,
  Sender,
  MessageEdit,
  DeletedMessage,
  TopicFilter,
} from "./types";

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

export function queryAll<T>(sql: string, params?: (string | number | null)[]): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  const rows = params ? stmt.all(...params) : stmt.all();
  return rows as T[];
}

// Detect the actual DB schema. The backend auto-migrates on connect; until then
// the frontend reader must degrade gracefully (no chat metadata / forum topics).
function tableColumns(table: string): Set<string> {
  try {
    const db = getDb();
    return new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name)
    );
  } catch {
    return new Set();
  }
}

function tableExists(name: string): boolean {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { name: string } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

const CHAT_COLS = tableColumns("chats");
const MESSAGE_COLS = tableColumns("messages");
const hasChatMeta = [
  "username",
  "description",
  "participant_count",
  "linked_chat_id",
  "megagroup",
  "broadcast",
  "is_verified",
  "forum",
  "gigagroup",
].every((c) => CHAT_COLS.has(c));
const hasTopicId = MESSAGE_COLS.has("topic_id");
const hasTopicsTable = tableExists("topics");
const hasFileName = MESSAGE_COLS.has("file_name") && MESSAGE_COLS.has("file_size");

const MESSAGE_COLUMNS = `m.chat_id, m.message_id, m.sender_id, m.sender_name, m.is_outgoing,
  m.date_unix, m.text, m.media_type, m.file_path, ${hasFileName ? "m.file_name, m.file_size" : "NULL AS file_name, NULL AS file_size"},
  m.media_duration, m.media_group_id,
  m.is_forward, m.fwd_from_chat_id, m.fwd_from_msg_id, m.fwd_from_date, m.fwd_from_author,
  m.reply_to_message_id, ${hasTopicId ? "m.topic_id" : "NULL AS topic_id"}, m.is_deleted, m.deleted_at_unix, m.downloaded_at_unix,
  (SELECT COUNT(*) FROM messages g
     WHERE g.chat_id = m.chat_id AND g.media_group_id IS NOT NULL AND g.media_group_id = m.media_group_id
  ) AS media_group_count`;

const MESSAGE_SELECT = `SELECT ${MESSAGE_COLUMNS} FROM messages m`;

const DELETED_PREVIEW = `CASE WHEN m.is_deleted = 1 THEN '🗑 Deleted ' || (
  CASE
    WHEN m.media_type IS NULL THEN COALESCE(m.text, '')
    WHEN m.media_type = 'photos' THEN 'Photo'
    WHEN m.media_type = 'videos' THEN 'Video'
    WHEN m.media_type = 'voice' THEN 'Voice message'
    WHEN m.media_type = 'audio' THEN 'Audio'
    WHEN m.media_type = 'documents' THEN 'Document'
    WHEN m.media_type = 'stickers' THEN 'Sticker'
    WHEN m.media_type = 'animations' THEN 'GIF'
    WHEN m.media_type = 'locations' THEN 'Location'
    WHEN m.media_type = 'contacts' THEN 'Contact'
    WHEN m.media_type = 'polls' THEN 'Poll'
    ELSE 'Message'
  END
) ELSE m.text END`;

function queryOne<T>(sql: string, params?: (string | number | null)[]): T | undefined {
  const db = getDb();
  const stmt = db.prepare(sql);
  const row = params ? stmt.get(...params) : stmt.get();
  return row as T | undefined;
}

function topicWhere(topicId?: TopicFilter, alias = "m."): string {
  if (!hasTopicId || topicId === undefined) return "";
  if (topicId === "general") return ` AND ${alias}topic_id IS NULL`;
  return ` AND ${alias}topic_id = ?`;
}

const CHAT_META_COLUMNS = hasChatMeta
  ? `c.username, c.description, c.participant_count, c.linked_chat_id,
     c.megagroup, c.broadcast, c.is_verified, c.forum, c.gigagroup`
  : `NULL AS username, NULL AS description, NULL AS participant_count, NULL AS linked_chat_id,
     0 AS megagroup, 0 AS broadcast, 0 AS is_verified, 0 AS forum, 0 AS gigagroup`;

const CHAT_COLUMNS = `c.chat_id, c.chat_name, c.chat_type, c.last_synced_message_id,
  ${CHAT_META_COLUMNS},
  (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.chat_id) AS message_count,
  (SELECT ${DELETED_PREVIEW} FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.date_unix DESC LIMIT 1) AS last_message_text,
  (SELECT date_unix FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.date_unix DESC LIMIT 1) AS last_message_date`;

export function getChats(search?: string): Chat[] {
  if (search) {
    return queryAll<Chat>(
      `SELECT ${CHAT_COLUMNS}
       FROM chats c WHERE c.chat_name LIKE ? ORDER BY last_message_date DESC`,
      [`%${search}%`]
    );
  }
  return queryAll<Chat>(
    `SELECT ${CHAT_COLUMNS}
     FROM chats c ORDER BY last_message_date DESC`
  );
}

export function getChat(chatId: number): Chat | undefined {
  return queryOne<Chat>(
    `SELECT ${CHAT_COLUMNS}
     FROM chats c WHERE c.chat_id = ?`,
    [chatId]
  );
}

export function getMessages(
  chatId: number,
  limit = 50,
  before?: number,
  topicId?: TopicFilter,
  mediaType?: string
): Message[] {
  const params: (string | number)[] = [chatId];
  if (before) params.push(before);
  if (hasTopicId && typeof topicId === "number") params.push(topicId);
  if (mediaType) params.push(mediaType);
  const mediaSql = mediaType ? ` AND m.media_type = ?` : "";
  if (before) {
    return queryAll<Message>(
      `${MESSAGE_SELECT} WHERE m.chat_id = ? AND m.message_id < ?${topicWhere(topicId)}${mediaSql} ORDER BY m.message_id DESC LIMIT ?`,
      [...params, limit]
    );
  }
  return queryAll<Message>(
    `${MESSAGE_SELECT} WHERE m.chat_id = ?${topicWhere(topicId)}${mediaSql} ORDER BY m.message_id DESC LIMIT ?`,
    [...params, limit]
  );
}

export function getMessagesAround(
  chatId: number,
  messageId: number,
  limit = 50,
  topicId?: TopicFilter,
  mediaType?: string
): Message[] {
  const params: (string | number)[] = [chatId, messageId];
  if (hasTopicId && typeof topicId === "number") params.push(topicId);
  if (mediaType) params.push(mediaType);
  const mediaSql = mediaType ? ` AND m.media_type = ?` : "";
  const before = queryAll<Message>(
    `${MESSAGE_SELECT} WHERE m.chat_id = ? AND m.message_id <= ?${topicWhere(topicId)}${mediaSql} ORDER BY m.message_id DESC LIMIT ?`,
    [...params, limit]
  );
  const after = queryAll<Message>(
    `${MESSAGE_SELECT} WHERE m.chat_id = ? AND m.message_id > ?${topicWhere(topicId)}${mediaSql} ORDER BY m.message_id ASC LIMIT ?`,
    [...params, limit]
  );
  return [...after.reverse(), ...before];
}

export function getSenders(chatId: number, topicId?: TopicFilter): Sender[] {
  const params: (string | number)[] = [chatId];
  if (hasTopicId && typeof topicId === "number") params.push(topicId);
  return queryAll<Sender>(
    `SELECT sender_id, sender_name, COUNT(*) AS message_count
     FROM messages WHERE chat_id = ?${topicWhere(topicId, "")} AND sender_name IS NOT NULL
     GROUP BY sender_id, sender_name ORDER BY message_count DESC`,
    params
  );
}

export function searchMessages(
  q: string,
  limit = 50,
  chatId?: number,
  senderName?: string,
  dateFrom?: number,
  dateTo?: number,
  topicId?: TopicFilter,
  mediaType?: string
): (Message & { chat_name: string })[] {
  let sql = `SELECT ${MESSAGE_COLUMNS}, c.chat_name FROM messages m JOIN chats c ON c.chat_id = m.chat_id WHERE m.text LIKE ?`;
  const params: (string | number)[] = [`%${q}%`];

  if (chatId) {
    sql += ` AND m.chat_id = ?`;
    params.push(chatId);
  }
  sql += topicWhere(topicId);
  if (hasTopicId && typeof topicId === "number") params.push(topicId);
  if (senderName) {
    sql += ` AND m.sender_name LIKE ?`;
    params.push(`%${senderName}%`);
  }
  if (mediaType) {
    sql += ` AND m.media_type = ?`;
    params.push(mediaType);
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
  offset = 0,
  topicId?: TopicFilter
): (Message & { chat_name: string })[] {
  let sql = `SELECT m.*, c.chat_name FROM messages m JOIN chats c ON c.chat_id = m.chat_id WHERE m.file_path IS NOT NULL AND m.media_type IS NOT NULL`;
  const params: (string | number)[] = [];

  if (chatId) {
    sql += ` AND m.chat_id = ?`;
    params.push(chatId);
  }
  sql += topicWhere(topicId);
  if (hasTopicId && typeof topicId === "number") params.push(topicId);
  if (mediaType) {
    sql += ` AND m.media_type = ?`;
    params.push(mediaType);
  }

  sql += ` ORDER BY m.date_unix DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return queryAll(sql, params);
}

export function getMediaCount(chatId?: number, mediaType?: string, topicId?: TopicFilter): number {
  let sql = `SELECT COUNT(*) as cnt FROM messages m WHERE m.file_path IS NOT NULL AND m.media_type IS NOT NULL`;
  const params: (string | number)[] = [];

  if (chatId) {
    sql += ` AND m.chat_id = ?`;
    params.push(chatId);
  }
  sql += topicWhere(topicId);
  if (hasTopicId && typeof topicId === "number") params.push(topicId);
  if (mediaType) {
    sql += ` AND m.media_type = ?`;
    params.push(mediaType);
  }

  const row = queryOne<{ cnt: number }>(sql, params);
  return Number(row?.cnt ?? 0);
}

export function getChatStats(chatId: number, topicId?: TopicFilter) {
  const params: number[] = [chatId];
  if (hasTopicId && typeof topicId === "number") params.push(topicId);
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
    FROM messages WHERE chat_id = ?${topicWhere(topicId, "")}`,
    params
  );

  const topicSubq = topicId !== undefined
    ? ` AND message_id IN (SELECT message_id FROM messages WHERE chat_id = ?${topicWhere(topicId, "")})`
    : "";
  const editParams: number[] = [chatId];
  if (topicId !== undefined) {
    editParams.push(chatId);
    if (typeof topicId === "number") editParams.push(topicId);
  }
  const editCount = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM message_edits WHERE chat_id = ?${topicSubq}`, editParams
  );
  const deleteCount = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM message_deleted WHERE chat_id = ?${topicSubq}`, editParams
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
    top_senders: getSenders(chatId, topicId),
    total_edits: Number(editCount?.cnt ?? 0),
    total_deletions: Number(deleteCount?.cnt ?? 0),
  };
}

export function getTopics(chatId: number): Topic[] {
  if (!hasTopicsTable || !hasTopicId) return [];
  return queryAll<Topic>(
    `SELECT t.chat_id, t.topic_id, t.title,
      CASE WHEN t.icon_emoji_id > 9007199254740991 THEN NULL ELSE t.icon_emoji_id END AS icon_emoji_id, t.icon_color,
      t.created_at_unix, t.is_closed, t.is_hidden, t.last_message_id,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = t.chat_id AND m.topic_id = t.topic_id) AS message_count,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = t.chat_id AND m.topic_id = t.topic_id AND m.file_path IS NOT NULL) AS media_count,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = t.chat_id AND m.topic_id = t.topic_id AND m.is_deleted = 1) AS deleted_count,
      (SELECT MAX(m.date_unix) FROM messages m WHERE m.chat_id = t.chat_id AND m.topic_id = t.topic_id) AS last_message_date,
      (SELECT ${DELETED_PREVIEW} FROM messages m WHERE m.chat_id = t.chat_id AND m.topic_id = t.topic_id ORDER BY m.date_unix DESC LIMIT 1) AS last_message_text
     FROM topics t WHERE t.chat_id = ? ORDER BY last_message_date DESC`,
    [chatId]
  );
}

export function getGeneralTopic(chatId: number): Topic | undefined {
  if (!hasTopicId) return undefined;
  return queryOne<Topic>(
    `SELECT ? AS chat_id, 0 AS topic_id, 'General' AS title, NULL AS icon_emoji_id,
      NULL AS icon_color, NULL AS created_at_unix, 0 AS is_closed, 0 AS is_hidden, NULL AS last_message_id,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = ? AND m.topic_id IS NULL) AS message_count,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = ? AND m.topic_id IS NULL AND m.file_path IS NOT NULL) AS media_count,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = ? AND m.topic_id IS NULL AND m.is_deleted = 1) AS deleted_count,
      (SELECT MAX(m.date_unix) FROM messages m WHERE m.chat_id = ? AND m.topic_id IS NULL) AS last_message_date,
      (SELECT ${DELETED_PREVIEW} FROM messages m WHERE m.chat_id = ? AND m.topic_id IS NULL ORDER BY m.date_unix DESC LIMIT 1) AS last_message_text`,
    [chatId, chatId, chatId, chatId, chatId, chatId]
  );
}

export function getGeneralTopicStats(chatId: number) {
  return getChatStats(chatId, "general");
}

export function getMessageEdits(chatId: number, messageId: number): MessageEdit[] {
  return queryAll<MessageEdit>(
    `SELECT old_text, new_text, edited_at_unix FROM message_edits
     WHERE chat_id = ? AND message_id = ? ORDER BY edited_at_unix`,
    [chatId, messageId]
  );
}

export function getDeletedMessages(chatId: number, limit = 50, topicId?: TopicFilter): DeletedMessage[] {
  const params: (string | number)[] = [chatId];
  let sql = `SELECT message_id, deleted_at_unix, old_text, old_sender_name, old_date_unix, old_media_type
     FROM message_deleted WHERE chat_id = ?`;
  if (topicId !== undefined) {
    sql += ` AND message_id IN (SELECT message_id FROM messages WHERE chat_id = ?${topicWhere(topicId, "")})`;
    params.push(chatId);
    if (hasTopicId && typeof topicId === "number") params.push(topicId);
  }
  sql += ` ORDER BY deleted_at_unix DESC LIMIT ?`;
  params.push(limit);
  return queryAll<DeletedMessage>(sql, params);
}

export function getChangesSince(unix: number) {
  const edits = queryAll<{ chat_id: number; message_id: number; old_text: string | null; new_text: string | null; edited_at_unix: number }>(
    `SELECT chat_id, message_id, old_text, new_text, edited_at_unix
     FROM message_edits WHERE edited_at_unix > ? ORDER BY edited_at_unix`,
    [unix]
  );
  const deletions = queryAll<{ chat_id: number; message_id: number; deleted_at_unix: number; old_text: string | null; old_sender_name: string | null; old_media_type: string | null }>(
    `SELECT chat_id, message_id, deleted_at_unix, old_text, old_sender_name, old_media_type
     FROM message_deleted WHERE deleted_at_unix > ? ORDER BY deleted_at_unix`,
    [unix]
  );
  const newMessages = queryAll<Message>(
    `SELECT * FROM messages WHERE date_unix > ? ORDER BY date_unix ASC`,
    [unix]
  );
  return { edits, deletions, newMessages };
}
