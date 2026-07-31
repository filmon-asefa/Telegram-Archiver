"use client";

import ChatList from "@/components/ChatList";
import SearchPanel from "@/components/SearchPanel";
import MediaGallery from "@/components/MediaGallery";
import { useState } from "react";

type Tab = "chats" | "search" | "media";

const TABS: { key: Tab; icon: JSX.Element; label: string }[] = [
  {
    key: "chats",
    label: "Chats",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
      </svg>
    ),
  },
  {
    key: "search",
    label: "Search",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    ),
  },
  {
    key: "media",
    label: "Media",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const [tab, setTab] = useState<Tab>("chats");

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-chat-list)" }}>
      {/* Tab header */}
      <div
        className="flex items-center gap-1 px-2 pt-2 pb-0"
        style={{ background: "var(--bg-chat-list)" }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
            style={{
              background: tab === t.key ? "var(--bg-chat-active)" : "transparent",
              color: tab === t.key ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === "chats" && <ChatList />}
        {tab === "search" && <SearchPanel />}
        {tab === "media" && <MediaGallery />}
      </div>
    </div>
  );
}
