import { NextRequest, NextResponse } from "next/server";
import { getDeletedMessages } from "@/lib/db";
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
  const topicId = req.nextUrl.searchParams.get("topic_id");
  const topicFilter = topicId === null || topicId === ""
    ? undefined
    : topicId === "general"
      ? "general" as const
      : (parseInt(topicId, 10) || undefined);

  const deleted = getDeletedMessages(chatId, limit, topicFilter);
  return NextResponse.json(deleted.map((d: Record<string, unknown>) => ({
    ...d,
    text: sanitizeText(d.text as string | null),
  })));
}
