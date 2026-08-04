"use client";

import { memo, useState } from "react";
import { formatTime, getMediaIcon, getSenderColor, encodeMediaPath } from "@/lib/utils";
import type { Message, MessageEdit } from "@/lib/types";
import VoiceMessage from "@/components/VoiceMessage";

const isPdf = (path: string) => path.toLowerCase().endsWith(".pdf");
const isVideoExt = (path: string) => /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(path);
const isImageExt = (path: string) => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(path);

function formatFileSize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(0)} KB`;
  return `${bytes} B`;
}

function deletedBadgeText(message: Message): string {
  if (message.media_type === "stickers") return "Deleted";
  return "🗑 Deleted on Telegram";
}

const DeletedBadge = ({ text, overlay }: { text: string; overlay?: boolean }) => (
  <span
    className={`deleted-badge${overlay ? " deleted-badge-overlay" : ""}`}
    title="This message was deleted on Telegram"
  >
    {text}
  </span>
);

function replyPreviewText(target: Message): { text: string; italic?: boolean } {
  if (target.text) return { text: target.text };
  const filename = target.file_name || target.file_path?.split("/").pop();
  const labels: Record<string, string> = {
    photos: "Photo",
    videos: "Video",
    voice: "Voice Message",
    audio: "Audio",
    documents: filename || "Document",
    stickers: "Sticker",
    animations: "GIF",
    contacts: "Contact",
    locations: "Location",
    polls: "Poll",
  };
  const label = target.media_type ? labels[target.media_type] ?? "File" : "Message";
  return { text: `${getMediaIcon(target.media_type)} ${label}` };
}

function ReplyHeader({
  target,
  onJumpToReply,
}: {
  target?: Message | null;
  onJumpToReply?: (messageId: number) => void;
}) {
  const preview = target === null
    ? { text: "Original message unavailable.", italic: true }
    : target
      ? replyPreviewText(target)
      : { text: "…", italic: false };

  const jump = () => {
    if (target) onJumpToReply?.(target.message_id);
  };

  return (
    <div
      className="reply-header"
      style={{ borderLeftColor: target ? getSenderColor(target.sender_name || "Unknown") : "var(--border)" }}
      role={target ? "button" : undefined}
      tabIndex={target ? 0 : undefined}
      onClick={jump}
      onKeyDown={(e) => {
        if (target && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          jump();
        }
      }}
      title={target ? "View original message" : undefined}
    >
      {target && target.sender_name && (
        <div
          className="reply-header-sender"
          style={{ color: getSenderColor(target.sender_name) }}
        >
          {target.sender_name}
        </div>
      )}
      <div className={`reply-header-preview ${preview.italic ? "reply-header-muted" : ""}`}>
        <span className="truncate">{preview.text}</span>
      </div>
    </div>
  );
}

const MediaPreview = memo(function MediaPreview({
  filePath,
  mediaType,
  fileName,
  fileSize,
}: {
  filePath: string;
  mediaType: string;
  fileName?: string | null;
  fileSize?: number | null;
}) {
  const [errored, setErrored] = useState(false);
  const src = `/media-files/${encodeMediaPath(filePath)}`;

  if (errored) {
    return (
      <div
        className="mt-1 flex items-center gap-2 text-xs rounded-lg px-3 py-2"
        style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}
      >
        <span>{getMediaIcon(mediaType)}</span>
        <span className="truncate">{mediaType}</span>
      </div>
    );
  }

  // Images, stickers, and GIFs. Telegram GIFs arrive as .gif or muted .mp4,
  // so video-based animations play inline and loop like an animated image.
  if (mediaType === "photos" || mediaType === "stickers" || mediaType === "animations") {
    if (isVideoExt(filePath)) {
      return (
        <div className="rounded-lg overflow-hidden max-w-[320px]">
          <video
            src={src}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            className="max-h-[320px] w-auto"
            onError={() => setErrored(true)}
          />
        </div>
      );
    }
    return (
      <div className="rounded-lg overflow-hidden max-w-[320px]">
        <img
          src={src}
          alt="Media"
          className="max-h-[320px] w-auto object-cover cursor-pointer"
          loading="lazy"
          onError={() => setErrored(true)}
        />
      </div>
    );
  }

  if (mediaType === "videos") {
    return (
      <div className="rounded-lg overflow-hidden max-w-[320px]">
        <video
          src={src}
          controls
          preload="metadata"
          className="max-h-[320px] w-auto"
          onError={() => setErrored(true)}
        />
      </div>
    );
  }

  if (mediaType === "voice" || mediaType === "audio") {
    return (
      <div>
        <audio
          src={src}
          controls
          preload="metadata"
          onError={() => setErrored(true)}
          className="max-w-[280px] h-8"
        />
      </div>
    );
  }

  if (mediaType === "documents") {
    if (isPdf(filePath)) {
      return (
        <div className="rounded-lg overflow-hidden max-w-[320px] max-h-[400px]">
          <embed
            src={src}
            type="application/pdf"
            className="w-full h-[300px] rounded-lg"
            onError={() => setErrored(true)}
          />
        </div>
      );
    }
    if (isVideoExt(filePath)) {
      return (
        <div className="rounded-lg overflow-hidden max-w-[320px]">
          <video
            src={src}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            className="max-h-[320px] w-auto"
            onError={() => setErrored(true)}
          />
        </div>
      );
    }
    if (isImageExt(filePath)) {
      return (
        <div className="rounded-lg overflow-hidden max-w-[320px]">
          <img
            src={src}
            alt="Media"
            className="max-h-[320px] w-auto object-cover cursor-pointer"
            loading="lazy"
            onError={() => setErrored(true)}
          />
        </div>
      );
    }
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="mt-1 flex items-center gap-2 text-xs rounded-lg px-3 py-2 max-w-[320px]"
      style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}
      title={`Open ${fileName || filePath.split("/").pop()}`}
    >
      <span className="flex-shrink-0">{getMediaIcon(mediaType)}</span>
      <span className="truncate font-medium" style={{ color: "var(--accent-color, #3390ec)" }}>
        {fileName || filePath.split("/").pop()}
      </span>
      {fileSize ? <span className="flex-shrink-0 ml-auto pl-2">{formatFileSize(fileSize)}</span> : null}
    </a>
  );
});

const CheckMark = () => (
  <svg className="w-[16px] h-[11px] ml-[1px]" viewBox="0 0 16 11" fill="none">
    <path d="M11 1L5 6L2 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 1L8 6L6.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function formatEditDate(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function MessageBubble({
  message,
  showSender,
  chatType,
  editCount,
  replyTarget,
  onJumpToReply,
  albumDeletedLeader = false,
}: {
  message: Message;
  showSender: boolean;
  chatType?: string;
  editCount?: number;
  replyTarget?: Message | null;
  onJumpToReply?: (messageId: number) => void;
  albumDeletedLeader?: boolean;
}) {
  const [showEdits, setShowEdits] = useState(false);
  const [edits, setEdits] = useState<MessageEdit[] | null>(null);
  const [loadingEdits, setLoadingEdits] = useState(false);

  const isChannel = chatType === "channel";
  const isUser = chatType === "user";
  const isGroup = chatType === "chat";

  const isOutgoing = !isChannel && message.is_outgoing === 1;
  const isVoice = message.media_type === "voice";
  const hasMedia = !!message.file_path && !!message.media_type;
  const hasPendingMedia = !message.file_path && !!message.media_type;
  const hasText = !!message.text;
  const isDeleted = message.is_deleted === 1;
  const shouldShowName = showSender && !isOutgoing && message.sender_name && !isUser;
  const wasEdited = editCount !== undefined && editCount > 0;

  const isAlbum = (message.media_group_count ?? 0) > 1;
  const showDeletedBadge = isDeleted && (!isAlbum || albumDeletedLeader);
  const deletedBadgeLabel =
    message.media_type === "stickers"
      ? "Deleted"
      : isAlbum && albumDeletedLeader
        ? "🗑 Album deleted on Telegram"
        : "🗑 Deleted on Telegram";

  const toggleEdits = async () => {
    if (showEdits) {
      setShowEdits(false);
      return;
    }
    if (edits) {
      setShowEdits(true);
      return;
    }
    setLoadingEdits(true);
    try {
      const res = await fetch(
        `/api/chats/${message.chat_id}/edits?message_id=${message.message_id}`
      );
      if (res.ok) {
        const data = await res.json();
        setEdits(data);
        setShowEdits(true);
      }
    } finally {
      setLoadingEdits(false);
    }
  };

  return (
    <div
      className={`flex mb-[2px] ${isChannel ? "px-[5%]" : "px-[10%]"} ${isOutgoing ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`message-bubble ${isOutgoing ? "out" : "in"} ${isVoice ? "voice-bubble" : ""} ${isDeleted ? "deleted-bubble" : ""}`}
        style={{ minWidth: (hasMedia || hasPendingMedia) && !isVoice ? "280px" : undefined }}
      >
        {!isVoice && <div className={isOutgoing ? "message-tail-out" : "message-tail-in"} />}

        {message.is_forward === 1 && (
          <div
            className="flex items-center gap-1 text-xs mb-[2px]"
            style={{ color: "var(--accent-color, #3390ec)" }}
          >
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 13.5v-3a4 4 0 0 1 4-4h5.293l-2.147-2.146a.5.5 0 0 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.793 7.5H5.5a3 3 0 0 0-3 3v3a.5.5 0 0 1-1 0Z"/>
            </svg>
            <span className="font-medium">Forwarded from {message.fwd_from_author || "Unknown"}</span>
          </div>
        )}

        {shouldShowName && (
          <div
            className="sender-name"
            style={{ color: getSenderColor(message.sender_name!) }}
          >
            {message.sender_name}
          </div>
        )}

        {message.reply_to_message_id != null && (
          <ReplyHeader target={replyTarget} onJumpToReply={onJumpToReply} />
        )}

        {isVoice && (hasMedia || hasPendingMedia) && (
          <div className="flex flex-col gap-1">
            {showDeletedBadge && <DeletedBadge text={deletedBadgeLabel} />}
            <div className={isDeleted ? "deleted-fade" : undefined}>
              <VoiceMessage
                message={message}
                isOutgoing={isOutgoing}
                wasEdited={wasEdited}
                onToggleEdits={toggleEdits}
              />
            </div>
          </div>
        )}

        {hasMedia && !isVoice && (
          <div className="relative w-fit max-w-full">
            {showDeletedBadge && <DeletedBadge text={deletedBadgeLabel} overlay />}
            <div className={isDeleted ? "deleted-fade" : undefined}>
              <MediaPreview
                filePath={message.file_path!}
                mediaType={message.media_type!}
                fileName={message.file_name}
                fileSize={message.file_size}
              />
            </div>
          </div>
        )}

        {hasPendingMedia && !isVoice && (
          <div className="relative w-fit max-w-full">
            {showDeletedBadge && <DeletedBadge text={deletedBadgeLabel} overlay />}
            <div
              className={`mt-1 flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${isDeleted ? "deleted-fade" : ""}`}
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}
            >
              <span>{getMediaIcon(message.media_type!)}</span>
              <span className="truncate">{message.media_type} — downloading…</span>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            {showDeletedBadge && !hasMedia && !hasPendingMedia && (
              <DeletedBadge text={deletedBadgeLabel} />
            )}
            {hasText && !isVoice && (
              <p
                className={`text-[14.5px] whitespace-pre-wrap break-words ${isDeleted ? "deleted-text" : ""}`}
                style={{ color: "var(--text-primary)" }}
              >
                {message.text}
              </p>
            )}
            {hasText && isVoice && (
              <p className={`voice-caption ${isDeleted ? "deleted-text" : ""}`} style={{ color: "var(--text-primary)" }}>
                {message.text}
              </p>
            )}
          </div>
          {(hasText || (!hasMedia && !hasPendingMedia)) && !isVoice && (
            <span
              className="text-[11px] whitespace-nowrap shrink-0 flex items-center gap-[2px] self-end pb-[1px]"
              style={{ color: isOutgoing ? "var(--text-time-out)" : "var(--text-time)" }}
            >
              {wasEdited && (
                <span className="cursor-pointer hover:underline mr-[3px]" onClick={toggleEdits} title="View edit history">edited</span>
              )}
              {formatTime(message.date_unix)}
              {isOutgoing && <CheckMark />}
            </span>
          )}
        </div>

        {(hasMedia || hasPendingMedia) && !hasText && !isVoice && (
          <div
            className="text-[11px] text-right mt-[2px] flex items-center justify-end gap-[2px]"
            style={{ color: isOutgoing ? "var(--text-time-out)" : "var(--text-time)" }}
          >
            {wasEdited && (
              <span className="cursor-pointer hover:underline mr-[3px]" onClick={toggleEdits} title="View edit history">edited</span>
            )}
            {formatTime(message.date_unix)}
            {isOutgoing && <CheckMark />}
          </div>
        )}

        {showEdits && edits && (
          <div
            className="mt-2 rounded-lg p-2 text-xs border"
            style={{
              background: "rgba(0,0,0,0.25)",
              borderColor: "rgba(255,255,255,0.08)",
              color: "var(--text-secondary)",
            }}
          >
            <div className="font-semibold mb-1" style={{ color: "var(--text-accent)" }}>
              Edit history ({edits.length})
            </div>
            {edits.map((e, i) => (
              <div key={i} className="py-1 border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <div className="flex items-center gap-1 mb-[2px]">
                  <span style={{ color: "var(--text-time)" }}>{formatEditDate(e.edited_at_unix)}</span>
                </div>
                {e.old_text && (
                  <div className="line-through opacity-60">{e.old_text}</div>
                )}
                {e.new_text && (
                  <div style={{ color: "var(--text-primary)" }}>{e.new_text}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {showEdits && loadingEdits && (
          <div className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            Loading edits…
          </div>
        )}
      </div>
    </div>
  );
}
