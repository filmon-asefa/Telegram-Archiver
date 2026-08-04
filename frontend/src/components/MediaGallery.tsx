"use client";

import { useState, useEffect, useCallback } from "react";
import { formatChatListDate, getAvatarColor, getInitials } from "@/lib/utils";

interface MediaMessage {
  chat_id: number;
  message_id: number;
  sender_name: string | null;
  date_unix: number;
  media_type: string | null;
  file_path: string | null;
  chat_name: string;
  text: string | null;
}

const MEDIA_TABS = [
  { key: "", label: "All" },
  { key: "photos", label: "📷 Photos" },
  { key: "videos", label: "🎬 Videos" },
  { key: "voice", label: "🎤 Voice" },
  { key: "documents", label: "📄 Files" },
  { key: "audio", label: "🎵 Audio" },
];

function encodeMediaPath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

function MediaItem({ item }: { item: MediaMessage }) {
  const [errored, setErrored] = useState(false);
  const src = item.file_path ? `/media-files/${encodeMediaPath(item.file_path)}` : "";

  const fallback = (
    <div
      className="w-full h-full flex items-center justify-center text-3xl"
      style={{ color: "var(--text-secondary)", background: "var(--bg-input)" }}
    >
      📎
    </div>
  );

  let content = fallback;

  if (!errored && src) {
    if (item.media_type === "photos") {
      content = (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setErrored(true)}
        />
      );
    } else if (item.media_type === "videos") {
      content = (
        <div className="w-full h-full relative">
          <video
            src={src}
            preload="metadata"
            className="w-full h-full object-cover"
            onError={() => setErrored(true)}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
              <span className="text-white ml-0.5">▶</span>
            </div>
          </div>
        </div>
      );
    }
  }

  const name = item.chat_name || "Unknown";
  const isDocument = item.media_type === "documents";

  return (
    <a
      href={isDocument && src ? src : `/chat/${item.chat_id}?msg=${item.message_id}`}
      target={isDocument && src ? "_blank" : undefined}
      rel={isDocument && src ? "noreferrer" : undefined}
      className="group relative aspect-square overflow-hidden"
      style={{ borderRadius: "8px" }}
      title={isDocument && src ? `Open ${src.split("/").pop()}` : undefined}
    >
      {content}
      <div
        className="absolute bottom-0 left-0 right-0 px-2 py-1 flex items-center justify-between"
        style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}
      >
        <div className="flex items-center gap-1 min-w-0">
          <div
            className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[6px] font-bold shrink-0"
            style={{ background: getAvatarColor(name) }}
          >
            {getInitials(name)}
          </div>
          <span className="text-[11px] text-white truncate">{name}</span>
        </div>
      </div>
    </a>
  );
}

export default function MediaGallery() {
  const [media, setMedia] = useState<MediaMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  const fetchMedia = useCallback(async (type: string, offset: number) => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
    });
    if (type) params.set("type", type);
    const res = await fetch(`/api/media?${params}`);
    const data = await res.json();
    setMedia(data.media);
    setTotal(data.total);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMedia(typeFilter, page * pageSize);
  }, [typeFilter, page, fetchMedia]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2 pb-1 flex gap-1 flex-wrap" style={{ background: "var(--bg-chat-list)" }}>
        {MEDIA_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTypeFilter(t.key); setPage(0); }}
            className="px-3 py-[5px] rounded-lg text-[13px] font-medium transition-colors"
            style={{
              background: typeFilter === t.key ? "var(--bg-chat-active)" : "var(--bg-input)",
              color: typeFilter === t.key ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="text-center text-sm py-8" style={{ color: "var(--text-secondary)" }}>
            Loading…
          </div>
        ) : media.length === 0 ? (
          <div className="text-center text-sm py-8" style={{ color: "var(--text-secondary)" }}>
            No media found
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1">
              {media.map((item, i) => (
                <MediaItem key={`${item.chat_id}-${item.message_id}-${i}`} item={item} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4 pb-4">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-4 py-[6px] rounded-lg text-[13px] font-medium disabled:opacity-40"
                  style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
                >
                  ← Prev
                </button>
                <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-4 py-[6px] rounded-lg text-[13px] font-medium disabled:opacity-40"
                  style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
