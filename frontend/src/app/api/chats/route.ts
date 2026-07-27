import { NextRequest, NextResponse } from "next/server";
import { getChats } from "@/lib/db";

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("q") || undefined;
  const chats = getChats(search);
  return NextResponse.json(chats);
}
