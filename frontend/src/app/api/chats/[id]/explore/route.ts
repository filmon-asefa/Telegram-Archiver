import { NextRequest, NextResponse } from "next/server";
import { getArchiveMessages, getArchiveCount } from "@/lib/db";
import { sanitizeMessage } from "@/lib/utils";
import type { ArchiveFilter, ArchiveSort } from "@/lib/types";

const VALID_SORTS = new Set<ArchiveSort>([
  "newest",
  "oldest",
  "largest",
  "smallest",
  "name",
  "sender",
  "duration",
]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const chatId = parseInt(id, 10);
  if (isNaN(chatId)) {
    return NextResponse.json({ error: "Invalid chat ID" }, { status: 400 });
  }

  const filter = (req.nextUrl.searchParams.get("filter") || "messages") as ArchiveFilter;
  const sortParam = req.nextUrl.searchParams.get("sort") || "newest";
  const sort: ArchiveSort = VALID_SORTS.has(sortParam as ArchiveSort)
    ? (sortParam as ArchiveSort)
    : "newest";
  const q = req.nextUrl.searchParams.get("q") || "";
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "50", 10) || 50, 1), 100);
  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get("offset") || "0", 10) || 0);

  const topicId = req.nextUrl.searchParams.get("topic_id");
  const topicFilter = topicId === null || topicId === ""
    ? undefined
    : topicId === "general"
      ? "general" as const
      : (parseInt(topicId, 10) || undefined);

  const sendersParam = req.nextUrl.searchParams.get("senders");
  const senders = sendersParam
    ? sendersParam.split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n))
    : undefined;

  const items = getArchiveMessages(chatId, filter, { sort, q, limit, offset, topicId: topicFilter, senders })
    .map(sanitizeMessage);
  const total = getArchiveCount(chatId, filter, { q, topicId: topicFilter, senders });

  return NextResponse.json({ items, total, offset, limit });
}
