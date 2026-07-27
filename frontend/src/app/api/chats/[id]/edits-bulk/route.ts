import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chatId = parseInt(id, 10);
  if (isNaN(chatId)) {
    return NextResponse.json({ error: "Invalid chat ID" }, { status: 400 });
  }

  const idsParam = req.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({});
  }

  const ids = idsParam.split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)).slice(0, 500);
  if (ids.length === 0) {
    return NextResponse.json({});
  }

  const placeholders = ids.map(() => "?").join(",");

  const counts = queryAll<{ message_id: number; cnt: number }>(
    `SELECT message_id, COUNT(*) as cnt FROM message_edits
     WHERE chat_id = ? AND message_id IN (${placeholders})
     GROUP BY message_id`,
    [chatId, ...ids]
  );

  const result: Record<number, number> = {};
  for (const row of counts) {
    result[row.message_id] = row.cnt;
  }

  return NextResponse.json(result);
}
