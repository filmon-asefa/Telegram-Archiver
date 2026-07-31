"""Fetch real topic names/metadata for forum chats and store them in the topics table."""
from __future__ import annotations

import asyncio
import logging

from telethon.tl.functions.messages import GetForumTopicsRequest
from telethon.tl.types import ForumTopicDeleted

from . import db
from .telegram_client import build_client, start_client

logger = logging.getLogger(__name__)

PAGE_SIZE = 100


MAX_SAFE_INTEGER = 2**53 - 1


def _safe_id(value: int | None) -> int | None:
    """Return *value* only if it is exactly representable as a JS number, else None."""
    if value is None:
        return None
    return value if -MAX_SAFE_INTEGER <= value <= MAX_SAFE_INTEGER else None


async def run_resolve_topics(chat_id: int | None = None) -> None:
    conn = db.get_connection()
    if chat_id is not None:
        rows = conn.execute("SELECT chat_id FROM chats WHERE forum = 1 AND chat_id = ?", (chat_id,)).fetchall()
    else:
        rows = conn.execute("SELECT chat_id FROM chats WHERE forum = 1").fetchall()
    if not rows:
        logger.info("No forum chats found.")
        return

    chat_ids = [r[0] for r in rows]
    logger.info("Resolving topic metadata for %s forum chat(s): %s", len(chat_ids), chat_ids)

    client = build_client(session_suffix="_topics")
    await start_client(client)

    for cid in chat_ids:
        total = 0
        offset_topic = 0
        offset_id = 0
        offset_date = None
        seen_ids: set[int] = set()
        while True:
            try:
                result = await client(
                    GetForumTopicsRequest(
                        peer=cid,
                        offset_date=offset_date,
                        offset_id=offset_id,
                        offset_topic=offset_topic,
                        limit=PAGE_SIZE,
                    )
                )
            except Exception:  # noqa: BLE001 - one forum chat shouldn't abort the rest
                logger.warning("  %s: could not fetch topics", cid, exc_info=True)
                break

            if not result.topics:
                break

            for ft in result.topics:
                if isinstance(ft, ForumTopicDeleted):
                    conn.execute("DELETE FROM topics WHERE chat_id = ? AND topic_id = ?", (cid, ft.id))
                    continue
                if ft.id == 1:
                    continue
                seen_ids.add(ft.id)
                db.upsert_topic(
                    chat_id=cid,
                    topic_id=ft.id,
                    title=ft.title,
                    icon_emoji_id=_safe_id(ft.icon_emoji_id),
                    icon_color=_safe_id(ft.icon_color),
                    created_at_unix=int(ft.date.timestamp()) if ft.date else None,
                    is_closed=bool(ft.closed),
                    is_hidden=bool(ft.hidden),
                    last_message_id=_safe_id(ft.top_message),
                )
                total += 1

            db.commit()
            logger.info("  %s: %s topics so far (server count=%s)", cid, total, result.count)
            if len(result.topics) < PAGE_SIZE:
                break

            last = result.topics[-1]
            offset_topic = last.id
            offset_id = last.top_message
            offset_date = last.date
            await asyncio.sleep(0.3)

        conn.execute(
            "DELETE FROM topics WHERE chat_id = ? AND topic_id NOT IN ({})".format(
                ",".join("?" * len(seen_ids))
            ),
            [cid, *sorted(seen_ids)],
        )

        orphans = conn.execute(
            "SELECT DISTINCT topic_id FROM messages WHERE chat_id = ? AND topic_id IS NOT NULL "
            "AND topic_id NOT IN (SELECT topic_id FROM topics WHERE chat_id = ?)",
            (cid, cid),
        ).fetchall()
        for row in orphans:
            db.upsert_topic(chat_id=cid, topic_id=row[0], title=f"Topic {row[0]}")
        db.commit()
        logger.info("  %s: %s topics resolved, %s orphan topic(s) materialized", cid, total, len(orphans))

    db.commit()
