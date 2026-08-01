// Shared API/domain types. Single source of truth so server-side readers and
// client components use the same shapes instead of redeclaring them.

export interface Chat {
  chat_id: number;
  chat_name: string;
  chat_type: string;
  last_synced_message_id: number;
  username: string | null;
  description: string | null;
  participant_count: number | null;
  linked_chat_id: number | null;
  megagroup: number;
  broadcast: number;
  is_verified: number;
  forum: number;
  gigagroup: number;
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
  file_name: string | null;
  file_size: number | null;
  media_duration: number | null;
  media_group_id: number | null;
  media_group_count: number | null;
  is_forward: number;
  fwd_from_chat_id: number | null;
  fwd_from_msg_id: number | null;
  fwd_from_date: number | null;
  fwd_from_author: string | null;
  reply_to_message_id: number | null;
  topic_id: number | null;
  is_deleted: number;
  deleted_at_unix: number | null;
}

export interface Topic {
  chat_id: number;
  topic_id: number;
  title: string | null;
  icon_emoji_id: number | null;
  icon_color: number | null;
  created_at_unix: number | null;
  is_closed: number;
  is_hidden: number;
  last_message_id: number | null;
  message_count: number;
  media_count: number;
  deleted_count: number;
  last_message_date: number | null;
  last_message_text: string | null;
}

export interface Sender {
  sender_id: number;
  sender_name: string;
  message_count: number;
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

export type TopicFilter = number | "general";
