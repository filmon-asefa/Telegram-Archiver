"use client";

import { useState } from "react";
import { formatTime, getMediaIcon, getSenderColor } from "@/lib/utils";

interface Message {
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

interface Edit {
  old_text: string | null;
  new_text: string | null;
  edited_at_unix: number;
}

function encodeMediaPath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

function MediaPreview({ filePath, mediaType }: { filePath: string; mediaType: string }) {
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

  if (mediaType === "photos") {
    return (
      <div className="rounded-lg overflow-hidden max-w-[320px]">
        <img
          src={src}
          alt="Photo"
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

  return (
    <div
      className="mt-1 flex items-center gap-2 text-xs rounded-lg px-3 py-2"
      style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}
    >
      <span>{getMediaIcon(mediaType)}</span>
      <span className="truncate">{filePath?.split("/").pop()}</span>
    </div>
  );
}

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
}: {
  message: Message;
  showSender: boolean;
  chatType?: string;
  editCount?: number;
}) {
  const [showEdits, setShowEdits] = useState(false);
  const [edits, setEdits] = useState<Edit[] | null>(null);
  const [loadingEdits, setLoadingEdits] = useState(false);

  const isChannel = chatType === "channel";
  const isUser = chatType === "user";
  const isGroup = chatType === "chat";

  const isOutgoing = !isChannel && message.is_outgoing === 1;
  const hasMedia = !!message.file_path && !!message.media_type;
  const hasPendingMedia = !message.file_path && !!message.media_type;
  const hasText = !!message.text;
  const shouldShowName = showSender && !isOutgoing && message.sender_name && !isUser;
  const wasEdited = editCount !== undefined && editCount > 0;

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
        className={`message-bubble ${isOutgoing ? "out" : "in"}`}
        style={{ minWidth: (hasMedia || hasPendingMedia) ? "280px" : undefined }}
      >
        <div className={isOutgoing ? "message-tail-out" : "message-tail-in"} />

        {shouldShowName && (
          <div
            className="sender-name"
            style={{ color: getSenderColor(message.sender_name!) }}
          >
            {message.sender_name}
          </div>
        )}

        {hasMedia && (
          <MediaPreview filePath={message.file_path!} mediaType={message.media_type!} />
        )}

        {hasPendingMedia && (
          <div
            className="mt-1 flex items-center gap-2 text-xs rounded-lg px-3 py-2 opacity-50"
            style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}
          >
            <span>{getMediaIcon(message.media_type!)}</span>
            <span className="truncate">{message.media_type} — downloading…</span>
          </div>
        )}

        {(hasText || (!hasMedia && !hasPendingMedia)) && (
          <div className="flex items-end gap-2">
            {hasText && (
              <p
                className="text-[14.5px] whitespace-pre-wrap break-words"
                style={{ color: "var(--text-primary)" }}
              >
                {message.text}
              </p>
            )}
            <span
              className="text-[11px] whitespace-nowrap shrink-0 flex items-center gap-[2px] self-end pb-[1px]"
              style={{ color: isOutgoing ? "var(--text-time-out)" : "var(--text-time)" }}
            >
              {wasEdited && (
                <span
                  className="cursor-pointer hover:underline mr-[3px]"
                  onClick={toggleEdits}
                  title="View edit history"
                >
                  edited
                </span>
              )}
              {formatTime(message.date_unix)}
              {isOutgoing && <CheckMark />}
            </span>
          </div>
        )}

        {(hasMedia || hasPendingMedia) && !hasText && (
          <div
            className="text-[11px] text-right mt-[2px] flex items-center justify-end gap-[2px]"
            style={{ color: isOutgoing ? "var(--text-time-out)" : "var(--text-time)" }}
          >
            {wasEdited && (
              <span
                className="cursor-pointer hover:underline mr-[3px]"
                onClick={toggleEdits}
                title="View edit history"
              >
                edited
              </span>
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
