"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import {
  formatChatListDate,
  truncate,
  getAvatarColor,
  getInitials,
} from "@/lib/utils";

interface Chat {
  chat_id: number;
  chat_name: string;
  chat_type: string;
  message_count: number;
  last_message_text: string | null;
  last_message_date: number | null;
}

function ChatTypeBadge({ chatType }: { chatType: string }) {
  if (chatType === "channel") {
    return (
      <div
        className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
        style={{ background: "var(--bg-chat-list)", border: "2px solid var(--bg-chat-list)" }}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="var(--text-accent)">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12H7v-2h5v2zm5-4H7V8h10v2z" />
        </svg>
      </div>
    );
  }
  if (chatType === "chat") {
    return (
      <div
        className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
        style={{ background: "var(--bg-chat-list)", border: "2px solid var(--bg-chat-list)" }}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#4ecca3">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
        </svg>
      </div>
    );
  }
  return null;
}

export default function ChatList() {
  const searchParams = useSearchParams();
  const activeId = searchParams.get("id");
  const [chats, setChats] = useState<Chat[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchChats = useCallback(async (q?: string) => {
    setLoading(true);
    const url = q ? `/api/chats?q=${encodeURIComponent(q)}` : "/api/chats";
    const res = await fetch(url);
    const data = await res.json();
    setChats(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchChats();
    const interval = setInterval(() => fetchChats(), 3000);
    return () => clearInterval(interval);
  }, [fetchChats]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchChats(query || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, fetchChats]);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-chat-list)" }}>
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
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl pl-10 pr-4 py-[7px] text-sm outline-none"
            style={{
              background: "var(--bg-input)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
            Loading…
          </div>
        ) : chats.length === 0 ? (
          <div className="p-4 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
            No chats found
          </div>
        ) : (
          chats.map((chat) => {
            const isActive = activeId === String(chat.chat_id);
            const name = chat.chat_name || "Unknown";
            const isGroup = chat.chat_type === "chat";
            const isChannel = chat.chat_type === "channel";
            return (
              <Link
                key={chat.chat_id}
                href={`/chat/${chat.chat_id}`}
                className="flex items-center gap-3 px-3 py-[7px] cursor-pointer transition-colors"
                style={{
                  background: isActive ? "var(--bg-chat-active)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "var(--bg-chat-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <div className="relative shrink-0">
                  <div
                    className="w-[50px] h-[50px] rounded-full flex items-center justify-center text-white font-semibold text-lg"
                    style={{ background: getAvatarColor(name) }}
                  >
                    {getInitials(name)}
                  </div>
                  <ChatTypeBadge chatType={chat.chat_type} />
                </div>
                <div className="flex-1 min-w-0 border-b py-[7px]" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 min-w-0">
                      {isChannel && (
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="var(--text-accent)">
                          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12H7v-2h5v2zm5-4H7V8h10v2z" />
                        </svg>
                      )}
                      {isGroup && (
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="#4ecca3">
                          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                        </svg>
                      )}
                      <span
                        className="font-semibold text-[14.5px] truncate"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {name}
                      </span>
                    </div>
                    <span
                      className="text-xs shrink-0"
                      style={{ color: isActive ? "#a0c4e8" : "var(--text-secondary)" }}
                    >
                      {formatChatListDate(chat.last_message_date)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-[2px]">
                    <span
                      className="text-[13px] truncate"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {truncate(chat.last_message_text, 55) || "No messages"}
                    </span>
                    <span
                      className="text-[11px] shrink-0 px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: "var(--bg-chat-active)", color: "var(--text-primary)" }}
                    >
                      {chat.message_count.toLocaleString()}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
