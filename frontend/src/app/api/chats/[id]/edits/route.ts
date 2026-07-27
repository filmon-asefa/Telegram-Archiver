import { NextRequest, NextResponse } from "next/server";
import { getMessageEdits } from "@/lib/db";
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

  const messageId = parseInt(req.nextUrl.searchParams.get("message_id") || "0", 10);
  if (!messageId) {
    return NextResponse.json({ error: "message_id required" }, { status: 400 });
  }

  const edits = getMessageEdits(chatId, messageId);
  return NextResponse.json(edits.map((e: Record<string, unknown>) => ({
    ...e,
    text: sanitizeText(e.text as string | null),
    new_text: sanitizeText(e.new_text as string | null),
  })));
}
