import { NextResponse } from "next/server";

const SSE_URL = process.env.SSE_URL || "http://127.0.0.1:8090/events";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const upstream = await fetch(SSE_URL, {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "SSE upstream unavailable" }, { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return NextResponse.json({ error: "SSE upstream unavailable" }, { status: 502 });
  }
}
