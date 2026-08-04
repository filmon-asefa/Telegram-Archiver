"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Music,
  Play,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import type {
  ArchiveFilter,
  ArchiveSort,
  ChatStats,
  ExploreResponse,
  Message,
  TopicFilter,
} from "@/lib/types";
import {
  encodeMediaPath,
  formatChatListDate,
  formatFileSize,
  getAvatarColor,
  getInitials,
  getMediaIcon,
} from "@/lib/utils";
import VoiceMessage from "@/components/VoiceMessage";

export type { ArchiveFilter } from "@/lib/types";

const FILTER_LABELS: Record<ArchiveFilter, string> = {
  messages: "Messages",
  photos: "Photos",
  videos: "Videos",
  voice: "Voice",
  audio: "Audio",
  documents: "Documents",
  animations: "GIFs",
  stickers: "Stickers",
  links: "Links",
  locations: "Locations",
  contacts: "Contacts",
  polls: "Polls",
  replies: "Replies",
  forwarded: "Forwarded",
  pinned: "Pinned",
  edited: "Edited",
  deleted: "Deleted",
  albums: "Media Albums",
};

const GRID_FILTERS = new Set<ArchiveFilter>(["photos", "animations", "stickers", "albums"]);

const MEDIA_LABELS: Record<string, string> = {
  photos: "Photo",
  videos: "Video",
  voice: "Voice message",
  audio: "Audio",
  documents: "Document",
  stickers: "Sticker",
  animations: "GIF",
  locations: "Location",
  contacts: "Contact",
  polls: "Poll",
};

const DEFAULT_SORT: Record<ArchiveFilter, ArchiveSort> = {
  messages: "oldest",
  photos: "newest",
  videos: "newest",
  voice: "newest",
  audio: "newest",
  documents: "newest",
  animations: "newest",
  stickers: "newest",
  links: "newest",
  locations: "newest",
  contacts: "newest",
  polls: "newest",
  replies: "newest",
  forwarded: "newest",
  pinned: "newest",
  edited: "newest",
  deleted: "newest",
  albums: "newest",
};

const SORT_OPTIONS: Record<ArchiveFilter, { value: ArchiveSort; label: string }[]> = {
  messages: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "sender", label: "Sender" },
  ],
  photos: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "largest", label: "Largest" },
    { value: "smallest", label: "Smallest" },
  ],
  animations: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "largest", label: "Largest" },
    { value: "smallest", label: "Smallest" },
  ],
  stickers: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
  ],
  albums: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
  ],
  videos: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "largest", label: "Largest" },
    { value: "smallest", label: "Smallest" },
    { value: "duration", label: "Duration" },
  ],
  voice: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "duration", label: "Duration" },
    { value: "sender", label: "Sender" },
  ],
  audio: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "duration", label: "Duration" },
    { value: "name", label: "Name" },
    { value: "sender", label: "Sender" },
  ],
  documents: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "largest", label: "Largest" },
    { value: "smallest", label: "Smallest" },
    { value: "name", label: "Name" },
    { value: "sender", label: "Sender" },
  ],
  links: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "sender", label: "Sender" },
  ],
  locations: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
  ],
  contacts: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
  ],
  polls: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
  ],
  replies: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "sender", label: "Sender" },
  ],
  forwarded: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "sender", label: "Sender" },
  ],
  pinned: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "sender", label: "Sender" },
  ],
  edited: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "sender", label: "Sender" },
  ],
  deleted: [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "sender", label: "Sender" },
  ],
};

const PAGE_SIZE = 50;

function mediaUrl(filePath: string): string {
  return `/media-files/${encodeMediaPath(filePath)}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds <= 0) return "";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${m}:${ss}`;
}

function fileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toUpperCase() : "";
}

const isVideoPath = (p: string | null) => /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(p || "");

function DeletedBadge() {
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
      style={{
        color: "#ff8080",
        background: "rgba(255,68,68,0.12)",
        border: "1px solid rgba(255,92,92,0.4)",
      }}
      title="This message was deleted on Telegram"
    >
      DELETED
    </span>
  );
}

function DownloadButton({ filePath, title }: { filePath: string; title: string }) {
  return (
    <a
      href={mediaUrl(filePath)}
      download={title}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center justify-center w-8 h-8 rounded-full transition-colors shrink-0"
      style={{ color: "var(--text-secondary)" }}
      title={`Download ${title}`}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Download size={15} />
    </a>
  );
}

function JumpButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center justify-center w-8 h-8 rounded-full transition-colors shrink-0"
      style={{ color: "var(--text-secondary)" }}
      title={label}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <ExternalLink size={15} />
    </button>
  );
}

function SenderAvatar({ name, size = 28 }: { name: string | null; size?: number }) {
  const label = name || "?";
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{
        width: size,
        height: size,
        background: getAvatarColor(label),
        fontSize: size >= 24 ? 11 : 9,
      }}
    >
      {getInitials(label)}
    </div>
  );
}

function PhotoTile({ m, onOpen }: { m: Message; onOpen: () => void }) {
  const [errored, setErrored] = useState(false);
  const src = m.file_path ? mediaUrl(m.file_path) : "";
  const deleted = m.is_deleted === 1;
  const animatedVideo = m.media_type === "animations" && isVideoPath(m.file_path);

  return (
    <button
      onClick={onOpen}
      className="group relative w-full block overflow-hidden cursor-pointer"
      style={{ borderRadius: 8, marginBottom: 6, breakInside: "avoid" }}
    >
      {errored || !src ? (
        <div
          className="w-full aspect-square flex items-center justify-center text-2xl"
          style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}
        >
          {getMediaIcon(m.media_type)}
        </div>
      ) : animatedVideo ? (
        <video src={src} muted loop playsInline preload="metadata" className="w-full" onError={() => setErrored(true)} />
      ) : (
        <img
          src={src}
          alt={m.text || m.media_type || ""}
          loading="lazy"
          className="w-full"
          onError={() => setErrored(true)}
        />
      )}
      {deleted && (
        <span
          className="absolute top-1 left-1 text-[9px] font-semibold px-1 py-0.5 rounded z-[1]"
          style={{ color: "#ff8080", background: "rgba(20,20,24,0.82)", border: "1px solid rgba(255,92,92,0.45)" }}
        >
          DELETED
        </span>
      )}
      {m.media_group_id != null && (
        <span
          className="absolute top-1 right-1 text-[9px] font-semibold px-1 py-0.5 rounded z-[1]"
          style={{ color: "#fff", background: "rgba(0,0,0,0.55)" }}
        >
          ALBUM
        </span>
      )}
      <div
        className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-left"
        style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.78))", borderRadius: "0 0 8px 8px" }}
      >
        <div className="flex items-center gap-1 min-w-0">
          <SenderAvatar name={m.sender_name} size={12} />
          <span className="text-[10px] text-white truncate">{m.sender_name}</span>
          <span className="ml-auto text-[10px] text-white/70 shrink-0">{formatChatListDate(m.date_unix)}</span>
        </div>
      </div>
    </button>
  );
}

function VideoRow({ m, onJump, onPlay }: { m: Message; onJump: (id: number) => void; onPlay: () => void }) {
  const src = m.file_path ? mediaUrl(m.file_path) : "";
  const name = m.file_name || m.file_path?.split("/").pop() || "Video";
  return (
    <div
      className="flex items-center gap-3 px-2 py-2 rounded-lg transition-colors"
      style={{ color: "var(--text-primary)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <button
        onClick={onPlay}
        className="relative w-24 h-14 rounded-lg overflow-hidden shrink-0 cursor-pointer bg-black"
        title="Play video"
      >
        {src ? (
          <video src={src} preload="metadata" muted playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--bg-input)" }}>
            {getMediaIcon("videos")}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-black/55">
            <Play size={16} fill="#fff" style={{ color: "#fff", marginLeft: 2 }} />
          </div>
        </div>
        {m.media_duration != null && (
          <span
            className="absolute bottom-1 right-1 text-[10px] font-semibold px-1 rounded"
            style={{ color: "#fff", background: "rgba(0,0,0,0.7)" }}
          >
            {formatDuration(m.media_duration)}
          </span>
        )}
      </button>
      <button
        onClick={() => onJump(m.message_id)}
        className="flex-1 min-w-0 text-left cursor-pointer"
      >
        <div className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
          {name}
        </div>
        <div className="text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
          {m.sender_name || "Unknown"} · {formatChatListDate(m.date_unix)}
        </div>
        {m.file_size != null && (
          <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            {formatFileSize(m.file_size)}
          </div>
        )}
      </button>
      {m.file_path && <DownloadButton filePath={m.file_path} title={name} />}
      <JumpButton onClick={() => onJump(m.message_id)} label="Jump to original message" />
    </div>
  );
}

function VoiceRow({ m, onJump }: { m: Message; onJump: (id: number) => void }) {
  return (
    <div
      className="flex items-center gap-3 px-2 py-2 rounded-lg transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <SenderAvatar name={m.sender_name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[12px] font-medium truncate" style={{ color: getSenderColor(m.sender_name || "?") }}>
            {m.sender_name || "Unknown"}
          </span>
          {m.is_deleted === 1 && <DeletedBadge />}
          <span className="ml-auto text-[11px] shrink-0" style={{ color: "var(--text-secondary)" }}>
            {formatChatListDate(m.date_unix)}
          </span>
        </div>
        <VoiceMessage message={m} isOutgoing={false} wasEdited={false} onToggleEdits={() => {}} />
      </div>
      <JumpButton onClick={() => onJump(m.message_id)} label="Jump to original message" />
    </div>
  );
}

function AudioRow({ m, onJump }: { m: Message; onJump: (id: number) => void }) {
  const title = m.file_name || m.file_path?.split("/").pop() || m.sender_name || "Audio";
  return (
    <div
      className="flex items-center gap-3 px-2 py-2 rounded-lg transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div
        className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}
      >
        <Music size={20} />
      </div>
      <button onClick={() => onJump(m.message_id)} className="flex-1 min-w-0 text-left cursor-pointer">
        <div className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
          {title}
        </div>
        <div className="text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
          {m.sender_name || "Unknown"}
          {m.media_duration ? ` · ${formatDuration(m.media_duration)}` : ""} · {formatChatListDate(m.date_unix)}
        </div>
        {m.text && (
          <div className="text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
            {m.text}
          </div>
        )}
      </button>
      {m.file_path && <DownloadButton filePath={m.file_path} title={title} />}
      <JumpButton onClick={() => onJump(m.message_id)} label="Jump to original message" />
    </div>
  );
}

function DocumentRow({ m, onJump }: { m: Message; onJump: (id: number) => void }) {
  const name = m.file_name || m.file_path?.split("/").pop() || "Document";
  const ext = fileExtension(name);
  return (
    <div
      className="flex items-center gap-3 px-2 py-2 rounded-lg transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div
        className="w-12 h-12 rounded-lg flex flex-col items-center justify-center shrink-0 gap-0.5"
        style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}
      >
        <span className="text-base leading-none">{getMediaIcon("documents")}</span>
        {ext && (
          <span className="text-[8px] font-bold leading-none" style={{ color: "var(--text-accent)" }}>
            {ext}
          </span>
        )}
      </div>
      <button onClick={() => onJump(m.message_id)} className="flex-1 min-w-0 text-left cursor-pointer">
        <div className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
          {name}
        </div>
        <div className="text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
          {m.sender_name || "Unknown"} · {formatChatListDate(m.date_unix)}
        </div>
        {m.file_size != null && (
          <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            {formatFileSize(m.file_size)}
          </div>
        )}
      </button>
      {m.file_path && <DownloadButton filePath={m.file_path} title={name} />}
      <JumpButton onClick={() => onJump(m.message_id)} label="Jump to original message" />
    </div>
  );
}

function GenericRow({ m, onJump }: { m: Message; onJump: (id: number) => void }) {
  const deleted = m.is_deleted === 1;
  return (
    <button
      onClick={() => onJump(m.message_id)}
      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-colors text-left cursor-pointer"
      style={{ color: "var(--text-primary)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <SenderAvatar name={m.sender_name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {m.media_type && (
            <span className="text-[11px] shrink-0">{getMediaIcon(m.media_type)}</span>
          )}
          <span className="text-[12px] font-medium truncate" style={{ color: getSenderColor(m.sender_name || "?") }}>
            {m.sender_name || "Unknown"}
          </span>
          {deleted && <DeletedBadge />}
        </div>
        <div className="text-[13px] truncate" style={{ color: "var(--text-primary)" }}>
          {m.text || (
            <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
              {m.media_type ? `${MEDIA_LABELS[m.media_type] ?? "Media"} (no text)` : "No text"}
            </span>
          )}
        </div>
      </div>
      <span className="text-[11px] shrink-0" style={{ color: "var(--text-secondary)" }}>
        {formatChatListDate(m.date_unix)}
      </span>
    </button>
  );
}

function getSenderColor(name: string): string {
  const colors = ["#e17076", "#7bc862", "#e6ca69", "#65aadd", "#a695e7", "#ee7aae", "#6ec9cb", "#faa774"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function Viewer({
  items,
  index,
  chatName,
  onIndexChange,
  onClose,
  onJump,
}: {
  items: Message[];
  index: number;
  chatName: string;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onJump: (messageId: number) => void;
}) {
  const m = items[index];
  const src = m?.file_path ? mediaUrl(m.file_path) : "";
  const isVideo = !!m && (m.media_type === "videos" || isVideoPath(m.file_path));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndexChange(Math.max(0, index - 1));
      if (e.key === "ArrowRight") onIndexChange(Math.min(items.length - 1, index + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndexChange]);

  if (!m) return null;
  const name = m.file_name || m.file_path?.split("/").pop() || "Media";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "rgba(0,0,0,0.94)" }}>
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-9 h-9 rounded-full transition-colors"
          style={{ color: "#fff" }}
          title="Close"
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <X size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium truncate" style={{ color: "#fff" }}>
            {chatName}
          </div>
          <div className="text-[12px]" style={{ color: "rgba(255,255,255,0.6)" }}>
            {index + 1} / {items.length} · {m.sender_name || "Unknown"} · {formatChatListDate(m.date_unix)}
          </div>
        </div>
        {m.file_path && (
          <a
            href={src}
            download={name}
            className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full transition-colors"
            style={{ color: "#fff", background: "rgba(255,255,255,0.12)" }}
            title="Download"
          >
            <Download size={14} /> <span className="hidden sm:inline">Download</span>
          </a>
        )}
        <button
          onClick={() => onJump(m.message_id)}
          className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full transition-colors"
          style={{ color: "#fff", background: "var(--text-accent)" }}
          title="Open in conversation"
        >
          <ExternalLink size={14} /> <span className="hidden sm:inline">Open in chat</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center relative">
        {items.length > 1 && (
          <>
            <button
              onClick={() => onIndexChange(Math.max(0, index - 1))}
              disabled={index === 0}
              className="absolute left-2 md:left-6 w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 z-10"
              style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
              title="Previous"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              onClick={() => onIndexChange(Math.min(items.length - 1, index + 1))}
              disabled={index >= items.length - 1}
              className="absolute right-2 md:right-6 w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 z-10"
              style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
              title="Next"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
        {src ? (
          isVideo ? (
            <video
              key={m.message_id}
              src={src}
              controls
              autoPlay
              playsInline
              className="max-w-full max-h-full px-2"
              style={{ maxWidth: "100%", objectFit: "contain" }}
            />
          ) : (
            <img
              key={m.message_id}
              src={src}
              alt={m.text || ""}
              className="max-w-full max-h-full px-2"
              style={{ objectFit: "contain" }}
            />
          )
        ) : (
          <div className="text-center" style={{ color: "rgba(255,255,255,0.6)" }}>
            <div className="text-4xl mb-2">{getMediaIcon(m.media_type)}</div>
            <div className="text-sm">Media not downloaded</div>
          </div>
        )}
      </div>

      {m.text && (
        <div className="shrink-0 px-6 py-3 text-center text-[13px] max-w-[700px] mx-auto w-full" style={{ color: "rgba(255,255,255,0.85)" }}>
          {m.text}
        </div>
      )}
    </div>
  );
}

export default function ArchiveExplorer({
  chatId,
  chatName,
  filter,
  topic,
  senders,
  stats,
  onSendersChange,
  onClose,
  onJump,
}: {
  chatId: number;
  chatName: string;
  filter: ArchiveFilter;
  topic: TopicFilter | undefined;
  senders: number[];
  stats: ChatStats;
  onSendersChange: (ids: number[]) => void;
  onClose: () => void;
  onJump: (messageId: number) => void;
}) {
  const label = FILTER_LABELS[filter];
  const [sort, setSort] = useState<ArchiveSort>(DEFAULT_SORT[filter]);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [items, setItems] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [sendersOpen, setSendersOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, { items: Message[]; total: number }>>(new Map());
  const fetchSeqRef = useRef(0);
  const loadingRef = useRef(false);
  const stateRef = useRef({ cacheKey: "", nextOffset, total });
  const debouncedQRef = useRef(debouncedQ);

  const senderKey = senders.join(",");
  const topicKey = topic === undefined ? "" : topic === "general" ? "general" : String(topic);
  const cacheKey = `${filter}|${sort}|${debouncedQ}|${senderKey}|${topicKey}`;

  const prevFilterRef = useRef(filter);
  useEffect(() => {
    if (prevFilterRef.current !== filter) {
      setQ("");
      setDebouncedQ("");
      setSort(DEFAULT_SORT[filter]);
      setSendersOpen(false);
      setViewerIndex(null);
    }
    prevFilterRef.current = filter;
  }, [filter]);

  useEffect(() => {
    debouncedQRef.current = debouncedQ;
  }, [debouncedQ]);
  useEffect(() => {
    stateRef.current = { cacheKey, nextOffset, total };
  }, [cacheKey, nextOffset, total]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    async (key: string, offset: number, seq: number) => {
      const params = new URLSearchParams({
        filter,
        sort,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const dq = debouncedQRef.current;
      if (dq) params.set("q", dq);
      if (topic !== undefined) params.set("topic_id", topic === "general" ? "general" : String(topic));
      if (senders.length) params.set("senders", senders.join(","));

      setLoading(offset === 0);
      setLoadingMore(offset > 0);
      try {
        const res = await fetch(`/api/chats/${chatId}/explore?${params}`);
        if (!res.ok) throw new Error("explore failed");
        const data: ExploreResponse = await res.json();
        if (seq !== fetchSeqRef.current) return;
        const existing = cacheRef.current.get(key)?.items ?? [];
        const seen = new Set(existing.map((m) => m.message_id));
        const fresh = data.items.filter((m) => !seen.has(m.message_id));
        const merged = offset === 0 ? data.items : [...existing, ...fresh];
        cacheRef.current.set(key, { items: merged, total: data.total });
        setItems(merged);
        setTotal(data.total);
        setNextOffset(merged.length);
      } catch {
        // best-effort
      } finally {
        loadingRef.current = false;
        if (seq === fetchSeqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [chatId, filter, sort, topic, senders]
  );

  useEffect(() => {
    const cached = cacheRef.current.get(cacheKey);
    fetchSeqRef.current++;
    if (cached) {
      setItems(cached.items);
      setTotal(cached.total);
      setNextOffset(cached.items.length);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    setItems([]);
    setTotal(0);
    setNextOffset(0);
    setLoading(true);
    void fetchPage(cacheKey, 0, fetchSeqRef.current);
  }, [cacheKey, fetchPage]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [cacheKey]);

  const loadMore = useCallback(() => {
    const { cacheKey: key, nextOffset: off, total: t } = stateRef.current;
    if (loadingRef.current || off >= t) return;
    loadingRef.current = true;
    fetchPage(key, off, fetchSeqRef.current);
  }, [fetchPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { root: container, rootMargin: "600px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, cacheKey]);

  const hasMore = nextOffset < total;
  const isGrid = GRID_FILTERS.has(filter);

  const senderList = stats.top_senders;
  const senderById = useMemo(() => new Map(senderList.map((s) => [s.sender_id, s])), [senderList]);

  const setSortAndClose = (s: ArchiveSort) => {
    setSort(s);
    setSendersOpen(false);
  };

  const toggleSender = (id: number) => {
    onSendersChange(senders.includes(id) ? senders.filter((x) => x !== id) : [...senders, id]);
  };

  const emptyText =
    debouncedQ || senders.length > 0
      ? "No matching results"
      : `No ${label.toLowerCase()} in this chat`;

  return (
    <div className="archive-explorer absolute inset-0 z-30 flex flex-col" style={{ background: "var(--bg-body)" }}>
      <div
        className="shrink-0 px-2 py-[6px] flex items-center gap-2"
        style={{ background: "var(--bg-header)", borderBottom: "1px solid var(--border)" }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1 rounded-full transition-colors text-[13px] font-medium shrink-0"
          style={{ color: "var(--text-accent)" }}
          title="Back to conversation"
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Back</span>
        </button>
        <div className="min-w-0 shrink-0">
          <div className="font-semibold text-[14px] leading-tight truncate" style={{ color: "var(--text-primary)" }}>
            {label}
          </div>
          <div className="text-[11px] leading-tight" style={{ color: "var(--text-secondary)" }}>
            {total.toLocaleString()} item{total === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-secondary)" }} />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label}…`}
            className="w-36 sm:w-48 md:w-56 rounded-full pl-8 pr-3 py-[6px] text-[13px] outline-none"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-secondary)" }}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setSendersOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-[6px] rounded-full text-[12px] font-medium transition-colors ${senders.length ? "" : ""}`}
            style={{
              color: senders.length ? "#fff" : "var(--text-secondary)",
              background: senders.length ? "var(--text-accent)" : "var(--bg-input)",
            }}
            title="Filter by sender"
          >
            <Users size={13} />
            <span className="hidden md:inline">Senders</span>
            {senders.length > 0 && <span className="text-[11px]">({senders.length})</span>}
          </button>
          {sendersOpen && (
            <div
              className="absolute right-0 top-[calc(100%+4px)] w-60 rounded-xl py-1 z-40"
              style={{ background: "var(--bg-chat-list)", border: "1px solid var(--border)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
            >
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase" style={{ color: "var(--text-secondary)" }}>
                Filter by sender
              </div>
              {senders.length > 0 && (
                <button
                  onClick={() => onSendersChange([])}
                  className="w-full text-left px-3 py-1.5 text-[12px] hover:bg"
                  style={{ color: "var(--text-accent)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Clear sender filter
                </button>
              )}
              {senderList.length === 0 ? (
                <div className="px-3 py-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  No senders found
                </div>
              ) : (
                senderList.map((s) => {
                  const active = senders.includes(s.sender_id);
                  return (
                    <button
                      key={s.sender_id}
                      onClick={() => toggleSender(s.sender_id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 transition-colors"
                      style={{ background: active ? "var(--bg-chat-active)" : "transparent" }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = "var(--bg-chat-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <SenderAvatar name={s.sender_name} size={20} />
                      <span className="flex-1 min-w-0 text-[12px] truncate text-left" style={{ color: "var(--text-primary)" }}>
                        {s.sender_name}
                      </span>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                        {s.message_count}
                      </span>
                      <span
                        className="w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center"
                        style={{ borderColor: active ? "var(--text-accent)" : "var(--text-secondary)" }}
                      >
                        {active && <span className="text-[10px]" style={{ color: "var(--text-accent)" }}>✓</span>}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <SlidersHorizontal size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-secondary)" }} />
          <select
            value={sort}
            onChange={(e) => setSortAndClose(e.target.value as ArchiveSort)}
            className="pl-7 pr-2 py-[6px] rounded-full text-[12px] font-medium outline-none appearance-none cursor-pointer"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
            title="Sort"
          >
            {(SORT_OPTIONS[filter] ?? SORT_OPTIONS.messages).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {senders.length > 0 && (
        <div
          className="shrink-0 px-2 py-1 flex items-center gap-1 overflow-x-auto"
          style={{ background: "var(--bg-chat-list)", borderBottom: "1px solid var(--border)" }}
        >
          <span className="text-[11px] shrink-0" style={{ color: "var(--text-secondary)" }}>
            Senders:
          </span>
          {senders.map((id) => {
            const s = senderById.get(id);
            return (
              <button
                key={id}
                onClick={() => toggleSender(id)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] shrink-0 transition-colors"
                style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
                title="Remove sender filter"
              >
                <span className="truncate max-w-[120px]">{s?.sender_name ?? `ID ${id}`}</span>
                <X size={11} style={{ color: "var(--text-secondary)" }} />
              </button>
            );
          })}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-2">
        {loading ? (
          <div className="text-center text-sm py-10" style={{ color: "var(--text-secondary)" }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="text-center text-sm py-10" style={{ color: "var(--text-secondary)" }}>
            {emptyText}
          </div>
        ) : (
          <>
            {isGrid ? (
              <div className="archive-masonry gap-1.5">
                {items.map((m, i) => (
                  <PhotoTile key={m.message_id} m={m} onOpen={() => setViewerIndex(i)} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {items.map((m) => {
                  if (filter === "videos") {
                    return (
                      <VideoRow
                        key={m.message_id}
                        m={m}
                        onJump={onJump}
                        onPlay={() => setViewerIndex(items.findIndex((x) => x.message_id === m.message_id))}
                      />
                    );
                  }
                  if (filter === "voice") {
                    return <VoiceRow key={m.message_id} m={m} onJump={onJump} />;
                  }
                  if (filter === "audio") {
                    return <AudioRow key={m.message_id} m={m} onJump={onJump} />;
                  }
                  if (filter === "documents") {
                    return <DocumentRow key={m.message_id} m={m} onJump={onJump} />;
                  }
                  return <GenericRow key={m.message_id} m={m} onJump={onJump} />;
                })}
              </div>
            )}

            <div ref={sentinelRef} className="h-1" />
            {loadingMore && (
              <div className="text-center text-xs py-4" style={{ color: "var(--text-secondary)" }}>
                Loading more…
              </div>
            )}
            {!hasMore && items.length > 0 && (
              <div className="text-center text-xs py-4" style={{ color: "var(--text-secondary)" }}>
                End of results
              </div>
            )}
          </>
        )}
      </div>

      {viewerIndex != null && items[viewerIndex] && (
        <Viewer
          items={items}
          index={viewerIndex}
          chatName={chatName}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onJump={onJump}
        />
      )}
    </div>
  );
}
