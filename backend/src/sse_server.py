"""Server-Sent Events (SSE) server for pushing real-time updates to the frontend.

The listener calls :func:`broadcast` after every DB change (new message, edit,
delete, media download complete). Connected browsers receive the event over a
persistent ``/events`` stream, so the UI updates without polling.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from aiohttp import web

logger = logging.getLogger(__name__)

SSE_HOST = "127.0.0.1"
SSE_PORT = 8090
HEARTBEAT_SECONDS = 15

_clients: set[asyncio.Queue[tuple[str, dict[str, Any]]]] = set()
_runner: web.AppRunner | None = None


async def _events_handler(request: web.Request) -> web.StreamResponse:
    resp = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "X-Accel-Buffering": "no",
        },
    )
    await resp.prepare(request)
    queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue(maxsize=200)
    _clients.add(queue)
    try:
        while True:
            try:
                event_type, data = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                await resp.write(b": heartbeat\n\n")
                continue
            payload = json.dumps(data, ensure_ascii=False)
            await resp.write(f"event: {event_type}\ndata: {payload}\n\n".encode("utf-8"))
    except (asyncio.CancelledError, ConnectionResetError, ConnectionError):
        pass
    finally:
        _clients.discard(queue)
    return resp


def broadcast(event_type: str, data: dict[str, Any]) -> None:
    """Push an event to every connected SSE client. Safe to call from anywhere."""
    item = (event_type, data)
    for queue in list(_clients):
        try:
            queue.put_nowait(item)
        except asyncio.QueueFull:
            logger.debug("SSE client queue full, dropping event %s", event_type)


async def start_sse_server() -> None:
    """Start the SSE HTTP server. Must be called from the running event loop."""
    global _runner
    if _runner is not None:
        return
    app = web.Application()
    app.router.add_get("/events", _events_handler)
    _runner = web.AppRunner(app)
    await _runner.setup()
    site = web.TCPSite(_runner, SSE_HOST, SSE_PORT)
    await site.start()
    logger.info("SSE server listening on http://%s:%s/events", SSE_HOST, SSE_PORT)


async def stop_sse_server() -> None:
    """Stop the SSE HTTP server."""
    global _runner
    if _runner is not None:
        await _runner.cleanup()
        _runner = None
