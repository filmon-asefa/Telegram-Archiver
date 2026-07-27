import { NextRequest, NextResponse } from "next/server";
import { getMessages } from "@/lib/db";
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
  const beforeId = before ? parseInt(before, 10) : undefined;

  const messages = getMessages(chatId, limit, beforeId).map((m) => ({
    ...m,
    text: sanitizeText(m.text),
  }));
  return NextResponse.json(messages);
}
