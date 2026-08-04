"""Resolve `fwd_from_author` for existing forwarded messages that lack it."""
from __future__ import annotations

import asyncio
import logging

from . import db
from .telegram_client import build_client, entity_display_name, start_client

logger = logging.getLogger(__name__)


async def run_resolve() -> None:
    conn = db.get_connection()
    rows = conn.execute(
        "SELECT DISTINCT fwd_from_chat_id FROM messages WHERE is_forward = 1 AND fwd_from_author IS NULL AND fwd_from_chat_id IS NOT NULL"
    ).fetchall()
    if not rows:
        logger.info("No unresolved forward authors found.")
        return

    chat_ids = [r[0] for r in rows]
    logger.info("Resolving forward source names for %s chat(s)…", len(chat_ids))

    client = build_client(session_suffix="_fwd_fix")
    await start_client(client)

    chat_id_to_name: dict[int, str] = {}
    for cid in chat_ids:
        try:
            entity = await client.get_entity(cid)
            name = entity_display_name(entity) or "Unknown"
            chat_id_to_name[cid] = name
            logger.info("  %s → %s", cid, name)
        except Exception:
            logger.warning("  %s → could not resolve", cid, exc_info=True)
            chat_id_to_name[cid] = "Unknown"
        await asyncio.sleep(0.5)

    count = 0
    for cid, name in chat_id_to_name.items():
        updated = conn.execute(
            "UPDATE messages SET fwd_from_author = ? WHERE fwd_from_chat_id = ? AND fwd_from_author IS NULL",
            (name, cid),
        ).rowcount
        count += updated

    db.commit()
    logger.info("Updated %s message(s).", count)
    await client.disconnect()
