export function sanitizeText(text: string | null): string | null {
  if (!text) return text;
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

export function sanitizeMessage<T extends { text?: string | null }>(msg: T): T {
  if (msg.text) msg.text = sanitizeText(msg.text);
  return msg;
}

export function formatTimestamp(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function formatDate(unix: number): string {
  const d = new Date(unix * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

export function formatDateSeparator(unix: number): string {
  const d = new Date(unix * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  const thisYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: thisYear ? undefined : "numeric",
  });
}

export function formatChatListDate(unix: number | null): string {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  const diff = today.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getMediaIcon(type: string | null): string {
  switch (type) {
    case "photos": return "📷";
    case "videos": return "🎬";
    case "voice": return "🎤";
    case "audio": return "🎵";
    case "documents": return "📄";
    case "stickers": return "😀";
    case "animations": return "🎞️";
    case "contacts": return "👤";
    case "locations": return "📍";
    case "polls": return "📊";
    default: return "📎";
  }
}

export function normalizeChatType(type: string): string {
  switch (type) {
    case "chat":
    case "chatforbidden":
      return "group";
    case "channelforbidden":
      return "channel";
    default:
      return type;
  }
}

export function getChatTypeIcon(type: string): string {
  switch (normalizeChatType(type)) {
    case "user": return "👤";
    case "bot": return "🤖";
    case "group": return "👥";
    case "supergroup": return "👥";
    case "channel": return "📢";
    case "forum": return "🗂️";
    default: return "💬";
  }
}

export function getChatTypeLabel(type: string): string {
  switch (normalizeChatType(type)) {
    case "user": return "user";
    case "bot": return "bot";
    case "group": return "group";
    case "supergroup": return "group";
    case "channel": return "channel";
    case "forum": return "forum";
    default: return type;
  }
}

export function truncate(text: string | null, maxLen: number): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

const AVATAR_COLORS = [
  "#cd3d64", "#d67722", "#955cdb", "#40a7e3",
  "#4fae4e", "#e6804e", "#5eb5f7", "#ee7aae",
  "#e17076", "#6bc19b", "#faa05a", "#a695e7",
];

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const SENDER_COLORS = [
  "#e17076", "#7bc862", "#e6ca69", "#65aadd",
  "#a695e7", "#ee7aae", "#6ec9cb", "#faa774",
];

export function getSenderColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

export function encodeMediaPath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}
