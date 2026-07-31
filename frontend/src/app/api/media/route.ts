import { NextRequest, NextResponse } from "next/server";
import { getMedia, getMediaCount } from "@/lib/db";

export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chat_id")
    ? parseInt(req.nextUrl.searchParams.get("chat_id")!, 10)
    : undefined;
  const mediaType = req.nextUrl.searchParams.get("type") || undefined;
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);
  const topicId = req.nextUrl.searchParams.get("topic_id");
  const topicFilter = topicId === null || topicId === ""
    ? undefined
    : topicId === "general"
      ? "general" as const
      : (parseInt(topicId, 10) || undefined);

  const media = getMedia(chatId, mediaType, limit, offset, topicFilter);
  const total = getMediaCount(chatId, mediaType, topicFilter);

  return NextResponse.json({ media, total, offset, limit });
}
