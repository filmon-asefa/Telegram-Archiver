import { NextRequest, NextResponse } from "next/server";
import { getMessages, getMessagesAround } from "@/lib/db";
import { sanitizeText } from "@/lib/utils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chatId = parseInt(id, 10);
  if (isNaN(chatId)) {
    return NextResponse.json({ error: "Invalid chat ID" }, { status: 400 });
  }

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
  const before = req.nextUrl.searchParams.get("before");
  const around = req.nextUrl.searchParams.get("around");
  const topicId = req.nextUrl.searchParams.get("topic_id");
  const mediaType = req.nextUrl.searchParams.get("media_type") || undefined;
  const beforeId = before ? parseInt(before, 10) : undefined;
  const aroundId = around ? parseInt(around, 10) : undefined;
  const topicFilter = topicId === null || topicId === ""
    ? undefined
    : topicId === "general"
      ? "general" as const
      : (parseInt(topicId, 10) || undefined);

  let messages: ReturnType<typeof getMessages>;
  if (aroundId) {
    messages = getMessagesAround(chatId, aroundId, limit, topicFilter, mediaType);
  } else {
    messages = getMessages(chatId, limit, beforeId, topicFilter, mediaType);
  }
  return NextResponse.json(
    messages.map((m) => ({
      ...m,
      text: sanitizeText(m.text),
    }))
  );
}
