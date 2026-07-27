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
        <div className="flex items-center justify-center h-screen text-gray-400">
          Loading…
        </div>
      }
    >
      <ChatView params={params} />
    </Suspense>
  );
}
