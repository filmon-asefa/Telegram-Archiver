"use client";

import { useState, useEffect, useCallback } from "react";
import { formatChatListDate, getAvatarColor, getInitials } from "@/lib/utils";

interface SearchMessage {
  chat_id: number;
  message_id: number;
  sender_name: string | null;
  date_unix: number;
  text: string | null;
  media_type: string | null;
  file_path: string | null;
  chat_name: string;
}

export default function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setLoading(true);
    setHasSearched(true);
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=100`);
    const data = await res.json();
    setResults(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 500);
    return () => clearTimeout(timer);
  }, [query, doSearch]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2 pb-1" style={{ background: "var(--bg-chat-list)" }}>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
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
            placeholder="Search messages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl pl-10 pr-4 py-[7px] text-sm outline-none"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
            autoFocus
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
            Searching…
          </div>
        ) : !hasSearched ? (
          <div className="p-4 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
            Type to search messages
          </div>
        ) : results.length === 0 ? (
          <div className="p-4 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
            No results found
          </div>
        ) : (
          results.map((msg, i) => {
            const name = msg.chat_name || "Unknown";
            return (
              <a
                key={`${msg.chat_id}-${msg.message_id}-${i}`}
                href={`/chat/${msg.chat_id}?msg=${msg.message_id}`}
                className="flex items-center gap-3 px-3 py-[7px] cursor-pointer transition-colors"
                style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-chat-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div
                  className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
                  style={{ background: getAvatarColor(name) }}
                >
                  {getInitials(name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {name}
                    </span>
                    <span className="text-[12px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                      {formatChatListDate(msg.date_unix)}
                    </span>
                  </div>
                  {msg.sender_name && (
                    <div className="text-[12px]" style={{ color: "var(--text-accent)" }}>
                      {msg.sender_name}
                    </div>
                  )}
                  <p className="text-[13px] truncate mt-[1px]" style={{ color: "var(--text-secondary)" }}>
                    {msg.text || `${msg.media_type || "media"}`}
                  </p>
                </div>
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}
