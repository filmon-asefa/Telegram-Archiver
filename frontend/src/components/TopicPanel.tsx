"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { formatChatListDate, truncate } from "@/lib/utils";

export type TopicFilter = number | "general";

export interface TopicItem {
  chat_id: number;
  topic_id: number;
  title: string | null;
  icon_emoji_id: number | null;
  icon_color: number | null;
  is_closed: number;
  is_hidden: number;
  message_count: number;
  media_count: number;
  deleted_count: number;
  last_message_date: number | null;
  last_message_text: string | null;
}

export interface TopicSearchResult {
  message_id: number;
  text: string | null;
  sender_name: string | null;
  date_unix: number;
  topic_id: number | null;
}

const TOPIC_COLORS = ["#4f9cef", "#d66900", "#9e7a0b", "#ff5c5c", "#239f9f", "#8a67c9", "#5eb057", "#c06bae"];
const MEDIA_TYPES = [
  { value: "", label: "All messages" },
  { value: "photos", label: "Photos" },
  { value: "videos", label: "Videos" },
  { value: "documents", label: "Documents" },
  { value: "voice", label: "Voice" },
  { value: "audio", label: "Audio" },
  { value: "stickers", label: "Stickers" },
];

function topicColor(topic: { icon_color: number | null; topic_id: number }): string {
  if (topic.icon_color != null) {
    return `#${(topic.icon_color & 0xffffff).toString(16).padStart(6, "0")}`;
  }
  return TOPIC_COLORS[Math.abs(topic.topic_id) % TOPIC_COLORS.length];
}

export default function TopicPanel({
  chatId,
  chatName,
  topics,
  selectedTopic,
  onSelect,
  onJump,
  mediaFilter,
  onMediaFilter,
}: {
  chatId: number;
  chatName: string;
  topics: TopicItem[];
  selectedTopic: TopicFilter;
  onSelect: (t: TopicFilter) => void;
  onJump: (topicId: TopicFilter, messageId: number) => void;
  mediaFilter: string;
  onMediaFilter: (m: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TopicSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      setSearchError(false);
      abortRef.current?.abort();
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setSearching(true);
    setSearchError(false);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: query.trim(),
          chat_id: String(chatId),
          limit: "50",
        });
        if (selectedTopic !== undefined) {
          params.set("topic_id", selectedTopic === "general" ? "general" : String(selectedTopic));
        }
        if (mediaFilter) params.set("media_type", mediaFilter);
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error("search failed");
        const data: TopicSearchResult[] = await res.json();
        if (!controller.signal.aborted) {
          setResults(data);
          setSearching(false);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setSearching(false);
          setSearchError(true);
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, mediaFilter, chatId, selectedTopic]);

  const handleSelect = useCallback((t: TopicFilter) => {
    onSelect(t);
    setQuery("");
    setResults(null);
  }, [onSelect]);

  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: "var(--bg-chat-list)" }}>
      <div className="shrink-0 px-3 pt-3 pb-2 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="font-semibold text-[14px] mb-2 flex items-center justify-between">
          <span style={{ color: "var(--text-primary)" }}>Topics</span>
          <span className="text-[11px] font-normal" style={{ color: "var(--text-secondary)" }}>
            {chatName}
          </span>
        </div>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
            style={{ color: "var(--text-secondary)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search in this topic…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl pl-9 pr-3 py-[6px] text-sm outline-none"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
          />
        </div>
        <div className="flex gap-1 mt-2 overflow-x-auto">
          {MEDIA_TYPES.map((mt) => (
            <button
              key={mt.value}
              onClick={() => onMediaFilter(mt.value)}
              className="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap transition-colors"
              style={{
                color: mediaFilter === mt.value ? "#fff" : "var(--text-secondary)",
                background: mediaFilter === mt.value ? "var(--text-accent)" : "var(--bg-input)",
              }}
            >
              {mt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {query.trim().length >= 2 ? (
          searching ? (
            <div className="p-4 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
              Searching…
            </div>
          ) : searchError ? (
            <div className="p-4 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
              Search failed
            </div>
          ) : results && results.length === 0 ? (
            <div className="p-4 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
              No matches
            </div>
          ) : (
            (results ?? []).map((r) => (
              <button
                key={r.message_id}
                onClick={() => onJump(r.topic_id == null ? "general" : r.topic_id, r.message_id)}
                className="w-full text-left px-3 py-2 cursor-pointer transition-colors"
                style={{ color: "var(--text-primary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div className="text-[13px] truncate">{truncate(r.text, 60) || "(no text)"}</div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
                    {r.sender_name ?? "Unknown"}
                  </span>
                  <span className="text-[11px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                    {formatChatListDate(r.date_unix)}
                  </span>
                </div>
              </button>
            ))
          )
        ) : (
          topics.map((topic) => {
            const active =
              selectedTopic === topic.topic_id ||
              (selectedTopic === "general" && topic.topic_id === 0);
            return (
              <button
                key={topic.topic_id}
                onClick={() => handleSelect(topic.topic_id === 0 ? "general" : topic.topic_id)}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors"
                style={{
                  background: active ? "var(--bg-chat-active)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--bg-chat-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-semibold shrink-0"
                  style={{ background: topicColor(topic) }}
                >
                  {topic.topic_id === 0 ? "G" : ""}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span
                      className="font-semibold text-[13.5px] truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {topic.title ?? `Topic ${topic.topic_id}`}
                    </span>
                    {topic.is_closed === 1 && (
                      <svg
                        className="w-3 h-3 shrink-0"
                        viewBox="0 0 24 24"
                        fill="var(--text-secondary)"
                      >
                        <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3H9z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-[1px]">
                    <span className="text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                      {truncate(topic.last_message_text, 40) || "No messages"}
                    </span>
                    {topic.last_message_date && (
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                        {formatChatListDate(topic.last_message_date)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-[2px]">
                    <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {topic.message_count.toLocaleString()} msgs
                    </span>
                    {topic.media_count > 0 && (
                      <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        · {topic.media_count} media
                      </span>
                    )}
                    {topic.deleted_count > 0 && (
                      <span className="text-[11px]" style={{ color: "#ff4444" }}>
                        · {topic.deleted_count} deleted
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
