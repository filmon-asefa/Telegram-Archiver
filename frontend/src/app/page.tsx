export default function HomePage() {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "var(--bg-body)" }}>
      <div className="text-center" style={{ color: "var(--text-secondary)" }}>
        <div className="w-[120px] h-[120px] mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: "var(--bg-chat-list)" }}>
          <svg className="w-16 h-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
          </svg>
        </div>
        <h2 className="text-xl font-medium mb-1">Telegram Archiver</h2>
        <p className="text-sm">Select a chat to view messages</p>
      </div>
    </div>
  );
}
