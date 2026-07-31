import { NextRequest, NextResponse } from "next/server";
import { getChat, getChatStats, getTopics } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chatId = parseInt(id, 10);
  if (isNaN(chatId)) {
    return NextResponse.json({ error: "Invalid chat ID" }, { status: 400 });
  }

  const chat = getChat(chatId);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const topicId = req.nextUrl.searchParams.get("topic_id");
  const topicFilter = topicId === null || topicId === ""
    ? undefined
    : topicId === "general"
      ? "general" as const
      : (parseInt(topicId, 10) || undefined);

  const stats = getChatStats(chatId, topicFilter);
  const topics = getTopics(chatId);
  return NextResponse.json({ ...chat, stats, topics });
}
