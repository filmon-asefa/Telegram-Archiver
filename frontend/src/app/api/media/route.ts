import { NextRequest, NextResponse } from "next/server";
import { getMedia, getMediaCount } from "@/lib/db";

export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chat_id")
    ? parseInt(req.nextUrl.searchParams.get("chat_id")!, 10)
    : undefined;
  const mediaType = req.nextUrl.searchParams.get("type") || undefined;
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);

  const media = getMedia(chatId, mediaType, limit, offset);
  const total = getMediaCount(chatId, mediaType);

  return NextResponse.json({ media, total, offset, limit });
}
