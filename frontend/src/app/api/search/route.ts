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
  const dateFrom = req.nextUrl.searchParams.get("date_from")
    ? parseInt(req.nextUrl.searchParams.get("date_from")!, 10)
    : undefined;
  const dateTo = req.nextUrl.searchParams.get("date_to")
    ? parseInt(req.nextUrl.searchParams.get("date_to")!, 10)
    : undefined;

  const results = searchMessages(q, limit, chatId, senderName, dateFrom, dateTo);
  return NextResponse.json(results.map(sanitizeMessage));
}
