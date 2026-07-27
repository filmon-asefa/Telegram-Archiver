import { NextRequest, NextResponse } from "next/server";
import { getChangesSince } from "@/lib/db";
import { sanitizeText } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const sinceUnix = since ? parseInt(since, 10) : 0;
  if (isNaN(sinceUnix)) {
    return NextResponse.json({ error: "Invalid since parameter" }, { status: 400 });
  }

  const changes = getChangesSince(sinceUnix);
  return NextResponse.json({
    edits: changes.edits.map((e) => ({
      ...e,
      old_text: sanitizeText(e.old_text),
      new_text: sanitizeText(e.new_text),
    })),
    deletions: changes.deletions.map((d) => ({
      ...d,
      old_text: sanitizeText(d.old_text),
    })),
    newMessages: changes.newMessages.map((m) => ({
      ...m,
      text: sanitizeText(m.text),
    })),
  });
}
