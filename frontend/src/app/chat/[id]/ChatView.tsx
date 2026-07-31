"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import MessageBubble from "@/components/MessageBubble";
import { formatDateSeparator, getAvatarColor, getInitials } from "@/lib/utils";
import { useSseEvents } from "@/lib/useSseEvents";

interface ChatInfo {
  chat_id: number;
  chat_name: string;
  chat_type: string;
  message_count: number;
  stats: {
    total_messages: number;
    total_media: number;
    photos: number;
    videos: number;
    voice: number;
    documents: number;
    audio: number;
    stickers: number;
    first_message_date: number | null;
    last_message_date: number | null;
    top_senders: { sender_id: number; sender_name: string; message_count: number }[];
  };
}

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
  is_forward: number;
  fwd_from_author: string | null;
  reply_to_message_id: number | null;
  media_duration: number | null;
  media_group_id: number | null;
  media_group_count: number | null;
  is_deleted: number;
  deleted_at_unix: number | null;
}

interface DeletedMsg {
  message_id: number;
  deleted_at_unix: number;
  old_text: string | null;
  old_sender_name: string | null;
  old_date_unix: number | null;
  old_media_type: string | null;
}

function getDayKey(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function ChatView({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const searchParams = useSearchParams();
  const scrollToMsg = searchParams.get("msg");

  const [chatId, setChatId] = useState<number | null>(null);
  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialLoadDoneRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const [editCounts, setEditCounts] = useState<Record<number, number>>({});
  const [deletedMsgs, setDeletedMsgs] = useState<DeletedMsg[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [replyTargets, setReplyTargets] = useState<Record<number, Message | null>>({});
  const fetchingRepliesRef = useRef<Set<number>>(new Set());

  const albumBadgeLeaders = useMemo(() => {
    const leaders = new Set<number>();
    const seen = new Set<number>();
    for (const m of messages) {
      if (m.is_deleted === 1 && m.media_group_id != null && (m.media_group_count ?? 0) > 1) {
        if (!seen.has(m.media_group_id)) {
          seen.add(m.media_group_id);
          leaders.add(m.message_id);
        }
      }
    }
    return leaders;
  }, [messages]);

  useEffect(() => {
    params.then((p) => setChatId(parseInt(p.id, 10)));
  }, [params]);

  const fetchChat = useCallback(async (id: number) => {
    const res = await fetch(`/api/chats/${id}`);
    if (res.ok) setChat(await res.json());
  }, []);

  const fetchMessages = useCallback(
    async (id: number, before?: number) => {
      const p = new URLSearchParams({ limit: "100" });
      if (before) p.set("before", String(before));
      const res = await fetch(`/api/chats/${id}/messages?${p}`);
      const data: Message[] = await res.json();
      return data;
    },
    []
  );

  useEffect(() => {
    if (!chatId) return;
    initialLoadDoneRef.current = false;
    setLoading(true);
    setReplyTargets({});
    setInfoOpen(false);
    fetchingRepliesRef.current.clear();
    Promise.all([fetchChat(chatId), fetchMessages(chatId)]).then(
      ([, msgs]) => {
        setMessages(msgs);
        messagesRef.current = msgs;
        setHasMore(msgs.length === 100);
        setLoading(false);
      }
    );
  }, [chatId, fetchChat, fetchMessages]);

  const didPrependRef = useRef(false);
  const savedScrollRef = useRef(0);

  const loadMore = useCallback(async () => {
    if (!chatId || loadingMoreRef.current) return;
    const current = messagesRef.current;
    if (current.length === 0) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    const oldest = current[current.length - 1].message_id;
    const container = containerRef.current;

    try {
      const older = await fetchMessages(chatId, oldest);
      if (older.length === 0) {
        setHasMore(false);
      } else {
        const seen = new Set(current.map((m) => m.message_id));
        const fresh = older.filter((m) => !seen.has(m.message_id));
        if (fresh.length === 0) {
          setHasMore(false);
          return;
        }
        didPrependRef.current = true;
        savedScrollRef.current = container ? container.scrollHeight - container.scrollTop : 0;
        const next = [...current, ...fresh];
        messagesRef.current = next;
        setMessages(next);
        if (fresh.length < 100) setHasMore(false);
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [chatId, fetchMessages]);

  useEffect(() => {
    if (!didPrependRef.current) return;
    didPrependRef.current = false;
    const container = containerRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight - savedScrollRef.current;
    });
  }, [messages]);

  const hasMoreRef = useRef(true);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (container.scrollTop < 100 && hasMoreRef.current && !loadingMoreRef.current) {
          loadMore();
        }
      });
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loadMore]);

  useEffect(() => {
    if (!scrollToMsg || messages.length === 0) return;
    const el = document.getElementById(`msg-${scrollToMsg}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("highlight-flash");
      setTimeout(() => el.classList.remove("highlight-flash"), 1500);
    }
  }, [scrollToMsg, messages]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;

    if (!initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true;
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        if (hasMoreRef.current && container.scrollHeight <= container.clientHeight + 50) {
          loadMore();
        }
      });
    }
  }, [messages, loadMore]);

  useEffect(() => {
    if (!chatId || messages.length === 0) return;
    const ids = messages.map((m) => m.message_id).join(",");
    fetch(`/api/chats/${chatId}/edits-bulk?ids=${ids}`)
      .then((r) => r.json())
      .then((data: Record<number, number>) => setEditCounts(data))
      .catch(() => {});
  }, [chatId, messages]);

  useEffect(() => {
    if (!chatId) return;
    fetch(`/api/chats/${chatId}/deleted`)
      .then((r) => r.json())
      .then((data: DeletedMsg[]) => setDeletedMsgs(data))
      .catch(() => {});
  }, [chatId]);

  // Periodic DB refresh: reconciles file_path (media linked after download),
  // edits, deletions, and reply data even if an SSE event was missed.
  const refreshFromDb = useCallback(async () => {
    if (!chatId) return;
    try {
      const res = await fetch(`/api/chats/${chatId}/messages?limit=100`);
      if (!res.ok) return;
      const fetched: Message[] = await res.json();
      const existing = messagesRef.current;
      const fetchedMap = new Map(fetched.map((m) => [m.message_id, m]));

      let changed = false;
      const merged = existing.map((m) => {
        const fresh = fetchedMap.get(m.message_id);
        if (!fresh) return m;
        if (
          m.file_path !== fresh.file_path ||
          m.text !== fresh.text ||
          m.is_deleted !== fresh.is_deleted ||
          m.deleted_at_unix !== fresh.deleted_at_unix ||
          m.media_type !== fresh.media_type ||
          m.sender_name !== fresh.sender_name ||
          m.is_forward !== fresh.is_forward ||
          m.fwd_from_author !== fresh.fwd_from_author ||
          m.reply_to_message_id !== fresh.reply_to_message_id
        ) {
          changed = true;
          return { ...m, ...fresh };
        }
        return m;
      });

      const seen = new Set(existing.map((m) => m.message_id));
      const freshOnes = fetched.filter((m) => !seen.has(m.message_id));
      let next = merged;
      if (freshOnes.length > 0) {
        changed = true;
        next = [...freshOnes, ...merged];
      }

      if (changed) {
        messagesRef.current = next;
        setMessages(next);
        const container = containerRef.current;
        const wasAtBottom = container
          ? container.scrollHeight - container.scrollTop - container.clientHeight < 80
          : true;
        if (freshOnes.length > 0 && wasAtBottom) {
          requestAnimationFrame(() => {
            if (container) container.scrollTop = container.scrollHeight;
          });
        }
      }
    } catch {
      // refresh is a best-effort safety net
    }
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    refreshFromDb();
    const timer = setInterval(refreshFromDb, 5000);
    return () => clearInterval(timer);
  }, [chatId, refreshFromDb]);

  const scrollToAndHighlight = useCallback((messageId: number) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("highlight-flash");
    setTimeout(() => el.classList.remove("highlight-flash"), 1500);
    return true;
  }, []);

  const jumpToMessage = useCallback(
    (messageId: number) => {
      if (scrollToAndHighlight(messageId)) return;
      if (!chatId) return;
      fetch(`/api/chats/${chatId}/messages?around=${messageId}&limit=100`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: Message[] | null) => {
          if (!data) return;
          const seen = new Set(messagesRef.current.map((m) => m.message_id));
          const fresh = data.filter((m) => !seen.has(m.message_id));
          if (fresh.length > 0) {
            const next = [...messagesRef.current, ...fresh].sort(
              (a, b) => b.message_id - a.message_id
            );
            messagesRef.current = next;
            setMessages(next);
          }
          setTimeout(() => scrollToAndHighlight(messageId), 100);
        })
        .catch(() => {});
    },
    [chatId, scrollToAndHighlight]
  );

  // Resolve reply targets lazily: from the loaded list when possible, otherwise
  // fetch a window around the target so the reply header can render and jump.
  useEffect(() => {
    if (!chatId) return;
    const byId = new Map(messagesRef.current.map((m) => [m.message_id, m]));

    setReplyTargets((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const ridStr of Object.keys(next)) {
        const rid = Number(ridStr);
        const live = byId.get(rid);
        if (live && next[rid] !== live) {
          next[rid] = live;
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    const unresolved: number[] = [];
    for (const m of messagesRef.current) {
      const rid = m.reply_to_message_id;
      if (rid == null) continue;
      if (byId.has(rid)) {
        if (replyTargets[rid] === undefined) {
          setReplyTargets((prev) => ({ ...prev, [rid]: byId.get(rid)! }));
        }
        continue;
      }
      if (replyTargets[rid] !== undefined || fetchingRepliesRef.current.has(rid)) continue;
      unresolved.push(rid);
    }

    for (const rid of unresolved) {
      fetchingRepliesRef.current.add(rid);
      fetch(`/api/chats/${chatId}/messages?around=${rid}&limit=50`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: Message[] | null) => {
          fetchingRepliesRef.current.delete(rid);
          const found = data?.find((x) => x.message_id === rid) ?? null;
          setReplyTargets((prev) => ({ ...prev, [rid]: found }));
          if (found) {
            const seen = new Set(messagesRef.current.map((m) => m.message_id));
            const fresh = (data ?? []).filter((m) => !seen.has(m.message_id));
            if (fresh.length > 0) {
              const next = [...messagesRef.current, ...fresh].sort(
                (a, b) => b.message_id - a.message_id
              );
              messagesRef.current = next;
              setMessages(next);
            }
          }
        })
        .catch(() => {
          fetchingRepliesRef.current.delete(rid);
          setReplyTargets((prev) => ({ ...prev, [rid]: null }));
        });
    }
  }, [chatId, replyTargets, messages]);

  useSseEvents({
    new_message: (data) => {
      if (data.chat_id !== chatId) return;
      const seen = new Set(messagesRef.current.map((m) => m.message_id));
      if (seen.has(data.message_id)) return;
      const container = containerRef.current;
      const wasAtBottom = container
        ? container.scrollHeight - container.scrollTop - container.clientHeight < 80
        : true;
      const next = [
        {
          chat_id: data.chat_id,
          message_id: data.message_id,
          sender_id: data.sender_id ?? null,
          sender_name: data.sender_name ?? null,
          is_outgoing: data.is_outgoing ? 1 : 0,
          date_unix: data.date_unix,
          text: data.text ?? null,
          media_type: data.media_type ?? null,
          file_path: data.file_path ?? null,
          media_duration: data.media_duration ?? null,
          media_group_id: data.media_group_id ?? null,
          media_group_count: data.media_group_count ?? null,
          is_forward: data.is_forward ? 1 : 0,
          fwd_from_author: data.fwd_from_author ?? null,
          reply_to_message_id: data.reply_to_message_id ?? null,
          is_deleted: 0,
          deleted_at_unix: null,
        },
        ...messagesRef.current,
      ];
      messagesRef.current = next;
      setMessages(next);
      if (wasAtBottom) {
        requestAnimationFrame(() => {
          if (container) container.scrollTop = container.scrollHeight;
        });
      }
    },
    message_edit: (data) => {
      if (data.chat_id !== chatId) return;
      messagesRef.current = messagesRef.current.map((m) =>
        m.chat_id === data.chat_id && m.message_id === data.message_id
          ? { ...m, text: data.new_text ?? m.text }
          : m
      );
      setMessages([...messagesRef.current]);
      setEditCounts((prev) => ({
        ...prev,
        [data.message_id]: (prev[data.message_id] || 0) + 1,
      }));
    },
    message_delete: (data) => {
      if (data.chat_id !== chatId) return;
      messagesRef.current = messagesRef.current.map((m) =>
        m.chat_id === data.chat_id && m.message_id === data.message_id
          ? { ...m, is_deleted: 1, deleted_at_unix: Math.floor(Date.now() / 1000) }
          : m
      );
      setMessages([...messagesRef.current]);
      setDeletedMsgs((prev) => {
        if (prev.some((d) => d.message_id === data.message_id)) return prev;
        const msg = messagesRef.current.find((m) => m.message_id === data.message_id);
        return [
          {
            message_id: data.message_id,
            deleted_at_unix: Math.floor(Date.now() / 1000),
            old_text: msg?.text ?? null,
            old_sender_name: msg?.sender_name ?? null,
            old_date_unix: msg?.date_unix ?? null,
            old_media_type: msg?.media_type ?? null,
          },
          ...prev,
        ];
      });
    },
    media_ready: (data) => {
      if (data.chat_id !== chatId) return;
      let changed = false;
      messagesRef.current = messagesRef.current.map((m) => {
        if (m.chat_id === data.chat_id && m.message_id === data.message_id && m.file_path !== data.file_path) {
          changed = true;
          return { ...m, file_path: data.file_path };
        }
        return m;
      });
      if (changed) setMessages([...messagesRef.current]);
    },
  });

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: "var(--text-secondary)" }}>
        Loading…
      </div>
    );
  }

  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: "var(--text-secondary)" }}>
        Chat not found
      </div>
    );
  }

  const shouldShowSender = (msg: Message, idx: number) => {
    if (idx === 0) return true;
    return displayMessages[idx - 1].sender_id !== msg.sender_id;
  };

  const displayMessages = [...messages].reverse();
  const name = chat.chat_name || "Unknown";
  const chatType = chat.chat_type;
  const isUser = chatType === "user";
  const isGroup = chatType === "chat";
  const isChannel = chatType === "channel";

  const groupedMessages: ({ type: "date"; key: string; unix: number } | { type: "msg"; msg: Message; showSender: boolean; idx: number })[] = [];

  let lastDayKey = "";
  displayMessages.forEach((msg, idx) => {
    const dayKey = getDayKey(msg.date_unix);
    if (dayKey !== lastDayKey) {
      groupedMessages.push({ type: "date", key: `date-${dayKey}`, unix: msg.date_unix });
      lastDayKey = dayKey;
    }
    groupedMessages.push({ type: "msg", msg, showSender: shouldShowSender(msg, idx), idx });
  });

  let headerSubtitle = `${chat.message_count.toLocaleString()} messages`;
  if (isGroup) {
    const memberCount = chat.stats.top_senders.length;
    headerSubtitle = memberCount > 0
      ? `${memberCount} member${memberCount > 1 ? "s" : ""} · ${chat.message_count.toLocaleString()} messages`
      : `group · ${chat.message_count.toLocaleString()} messages`;
  } else if (isChannel) {
    headerSubtitle = `channel · ${chat.message_count.toLocaleString()} messages`;
  }

  return (
    <div className="flex flex-1 min-w-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <div
          className="flex items-center gap-2 px-2 py-[6px] shrink-0"
          style={{ background: "var(--bg-header)", borderBottom: "1px solid var(--border)" }}
        >
          <Link
            href="/"
            className="md:hidden flex items-center justify-center w-9 h-9 rounded-full shrink-0"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="relative shrink-0">
            <div
              className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-white font-semibold"
              style={{ background: getAvatarColor(name) }}
            >
              {getInitials(name)}
            </div>
            {isGroup && (
              <div
                className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                style={{ background: "var(--bg-header)" }}
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="#4ecca3">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                </svg>
              </div>
            )}
            {isChannel && (
              <div
                className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                style={{ background: "var(--bg-header)" }}
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="var(--text-accent)">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12H7v-2h5v2zm5-4H7V8h10v2z" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 ml-1">
            <div className="font-semibold text-[15px] truncate" style={{ color: "var(--text-primary)" }}>
              {name}
            </div>
            <div className="text-[13px] truncate" style={{ color: "var(--text-secondary)" }}>
              {headerSubtitle}
            </div>
          </div>
          <button
            onClick={() => setInfoOpen(true)}
            className="hidden md:flex lg:hidden items-center justify-center w-9 h-9 rounded-full shrink-0"
            style={{ color: "var(--text-secondary)" }}
            title="Chat info"
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5" />
              <path d="M12 8h.01" />
            </svg>
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto py-1"
          ref={containerRef}
          style={{ background: "var(--bg-body)" }}
        >
          {hasMore && displayMessages.length > 0 && (
            <div className="text-center py-3">
              {loadingMore ? (
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  Loading older messages…
                </span>
              ) : (
                <button
                  onClick={() => loadMore()}
                  className="text-xs px-4 py-1.5 rounded-full transition-colors"
                  style={{
                    color: "var(--text-accent)",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border)",
                  }}
                >
                  ↑ Load older messages
                </button>
              )}
            </div>
          )}
          {!hasMore && displayMessages.length > 0 && (
            <div className="text-center py-3">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Beginning of conversation
              </span>
            </div>
          )}
          {displayMessages.length === 0 ? (
            <div className="text-center py-8" style={{ color: "var(--text-secondary)" }}>
              No messages in this chat
            </div>
          ) : (
            <div className="max-w-[800px] mx-auto py-1">
              {groupedMessages.map((item) => {
                if (item.type === "date") {
                  return (
                    <div key={item.key} className="date-separator">
                      <span>{formatDateSeparator(item.unix)}</span>
                    </div>
                  );
                }
                return (
                  <div
                    key={`${item.msg.chat_id}-${item.msg.message_id}`}
                    id={`msg-${item.msg.message_id}`}
                  >
                    <MessageBubble
                      message={item.msg}
                      showSender={item.showSender}
                      chatType={chatType}
                      editCount={editCounts[item.msg.message_id]}
                      replyTarget={
                        item.msg.reply_to_message_id != null
                          ? replyTargets[item.msg.reply_to_message_id]
                          : undefined
                      }
                      onJumpToReply={jumpToMessage}
                      albumDeletedLeader={albumBadgeLeaders.has(item.msg.message_id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        className={`info-backdrop ${infoOpen ? "info-backdrop-open" : ""}`}
        onClick={() => setInfoOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`info-panel relative flex-col border-l ${infoOpen ? "info-panel-open" : ""}`}
        style={{ background: "var(--bg-chat-list)", borderColor: "var(--border)" }}
      >
        <button
          onClick={() => setInfoOpen(false)}
          className="lg:hidden absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center z-10"
          style={{ color: "var(--text-secondary)", background: "rgba(255,255,255,0.06)" }}
          title="Close chat info"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
        <div className="flex flex-col items-center py-6 px-4">
          <div className="relative mb-3">
            <div
              className="w-[100px] h-[100px] rounded-full flex items-center justify-center text-white font-bold text-3xl"
              style={{ background: getAvatarColor(name) }}
            >
              {getInitials(name)}
            </div>
            {isGroup && (
              <div
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "var(--bg-chat-list)", border: "3px solid var(--bg-chat-list)" }}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#4ecca3">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                </svg>
              </div>
            )}
            {isChannel && (
              <div
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "var(--bg-chat-list)", border: "3px solid var(--bg-chat-list)" }}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="var(--text-accent)">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12H7v-2h5v2zm5-4H7V8h10v2z" />
                </svg>
              </div>
            )}
          </div>
          <div className="font-semibold text-[15px] text-center" style={{ color: "var(--text-primary)" }}>
            {name}
          </div>
          <div className="text-[13px] mt-1" style={{ color: "var(--text-secondary)" }}>
            {isUser ? "user" : isGroup ? "group" : "channel"}
          </div>
        </div>

        <div className="px-4 pb-4">
          <h3 className="text-xs font-semibold uppercase mb-3" style={{ color: "var(--text-secondary)" }}>
            Statistics
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Messages", value: chat.stats.total_messages },
              { label: "Photos", value: chat.stats.photos },
              { label: "Videos", value: chat.stats.videos },
              { label: "Voice", value: chat.stats.voice },
              { label: "Documents", value: chat.stats.documents },
              { label: "Audio", value: chat.stats.audio },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg px-3 py-2"
                style={{ background: "var(--bg-input)" }}
              >
                <div className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                  {item.value?.toLocaleString() || 0}
                </div>
                <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {chat.stats.top_senders.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: "var(--text-secondary)" }}>
              {isChannel ? "Posters" : isGroup ? "Members" : "Senders"}
            </h3>
            {chat.stats.top_senders.slice(0, 8).map((s) => (
              <div
                key={s.sender_id}
                className="flex items-center gap-2 text-[13px] py-[3px]"
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                  style={{ background: getAvatarColor(s.sender_name || "Unknown") }}
                >
                  {getInitials(s.sender_name || "Unknown")}
                </div>
                <span className="truncate flex-1" style={{ color: "var(--text-primary)" }}>
                  {s.sender_name}
                </span>
                <span className="shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {s.message_count}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 pb-4">
          <h3 className="text-xs font-semibold uppercase mb-2" style={{ color: "var(--text-secondary)" }}>
            Info
          </h3>
          <div className="text-[13px] space-y-1" style={{ color: "var(--text-secondary)" }}>
            <div>Chat ID: <span style={{ color: "var(--text-primary)" }}>{chat.chat_id}</span></div>
            <div>Type: <span style={{ color: "var(--text-primary)" }}>{chatType}</span></div>
            {chat.stats?.first_message_date && (
              <div>First message: <span style={{ color: "var(--text-primary)" }}>{formatDateSeparator(chat.stats.first_message_date)}</span></div>
            )}
            {chat.stats?.last_message_date && (
              <div>Last message: <span style={{ color: "var(--text-primary)" }}>{formatDateSeparator(chat.stats.last_message_date)}</span></div>
            )}
            {(chat.stats as Record<string, unknown>).total_edits ? (
              <div>Edits tracked: <span style={{ color: "var(--text-primary)" }}>{String((chat.stats as Record<string, unknown>).total_edits)}</span></div>
            ) : null}
            {(chat.stats as Record<string, unknown>).total_deletions ? (
              <div>Deletions tracked: <span style={{ color: "var(--text-primary)" }}>{String((chat.stats as Record<string, unknown>).total_deletions)}</span></div>
            ) : null}
          </div>
        </div>

        {deletedMsgs.length > 0 && (
          <div className="px-4 pb-4">
            <button
              className="text-xs font-semibold uppercase mb-2 w-full text-left flex items-center justify-between"
              style={{ color: "var(--text-secondary)" }}
              onClick={() => setShowDeleted(!showDeleted)}
            >
              <span>Deleted Messages ({deletedMsgs.length})</span>
              <span>{showDeleted ? "▲" : "▼"}</span>
            </button>
            {showDeleted && deletedMsgs.slice(0, 20).map((d) => (
              <div
                key={d.message_id}
                className="rounded-lg px-3 py-2 mb-1 text-xs"
                style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.15)" }}
              >
                <div className="flex items-center gap-1 mb-1">
                  <span style={{ color: "#ff4444" }}>🗑 Deleted</span>
                  <span style={{ color: "var(--text-time)" }}>
                    {new Date(d.deleted_at_unix * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {d.old_sender_name && (
                  <div style={{ color: "var(--text-secondary)" }}>by {d.old_sender_name}</div>
                )}
                {d.old_media_type && (
                  <div className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    🗑 {d.old_media_type}
                  </div>
                )}
                {d.old_text && (
                  <div className="mt-1 line-through opacity-70" style={{ color: "var(--text-primary)" }}>
                    {d.old_text.length > 100 ? d.old_text.slice(0, 100) + "…" : d.old_text}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
