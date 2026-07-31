"use client";

import { Suspense } from "react";
import ChatView from "./ChatView";

export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center" style={{ color: "var(--text-secondary)" }}>
          Loading…
        </div>
      }
    >
      <ChatView params={params} />
    </Suspense>
  );
}
