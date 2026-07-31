import { NextRequest, NextResponse } from "next/server";
import { searchMessages } from "@/lib/db";
import { sanitizeMessage } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length > 200) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required (max 200 chars)" },
      { status: 400 }
    );
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50", 10), 100);
  const chatId = req.nextUrl.searchParams.get("chat_id")
    ? parseInt(req.nextUrl.searchParams.get("chat_id")!, 10)
    : undefined;
  const senderName = req.nextUrl.searchParams.get("sender") || undefined;
  const mediaType = req.nextUrl.searchParams.get("media_type") || undefined;
  const dateFrom = req.nextUrl.searchParams.get("date_from")
    ? parseInt(req.nextUrl.searchParams.get("date_from")!, 10)
    : undefined;
  const dateTo = req.nextUrl.searchParams.get("date_to")
    ? parseInt(req.nextUrl.searchParams.get("date_to")!, 10)
    : undefined;
  const topicId = req.nextUrl.searchParams.get("topic_id");
  const topicFilter = topicId === null || topicId === ""
    ? undefined
    : topicId === "general"
      ? "general" as const
      : (parseInt(topicId, 10) || undefined);

  const results = searchMessages(q, limit, chatId, senderName, dateFrom, dateTo, topicFilter, mediaType);
  return NextResponse.json(results.map(sanitizeMessage));
}
