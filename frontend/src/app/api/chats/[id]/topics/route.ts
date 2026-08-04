import { NextRequest, NextResponse } from "next/server";
import { getTopics, getGeneralTopic } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chatId = parseInt(id, 10);
  if (isNaN(chatId)) {
    return NextResponse.json({ error: "Invalid chat ID" }, { status: 400 });
  }

  return NextResponse.json({ topics: getTopics(chatId), general: getGeneralTopic(chatId) });
}
