"""Bulk export of full chat history into SQLite.

Resumable: each chat tracks last_synced_message_id, so re-running this
after an interruption only fetches messages newer than what's already saved.

CLI flags:
    --backfill           Backfill only (no listener)
    --backfill-all       Force full re-backfill from message 0 (ignores last_synced)
    --backfill-chat ID   Backfill a single chat by ID
    --no-media           Skip media downloads (text-only pass)
    --media-only         Only download media for messages missing file_path
"""
from __future__ import annotations

import asyncio
import logging

from telethon.errors import FloodWaitError

from . import db
from .config import settings
from .telegram_client import (
    DOWNLOADABLE_MEDIA_TYPES,
    build_client,
    build_message_row,
    canonical_chat_type,
    chat_metadata,
    document_meta,
    download_with_retry,
    extract_topic_create,
    start_client,
)
from .utils.media_storage import get_chat_folder

logger = logging.getLogger(__name__)

MAX_FLOOD_RETRIES = 5


async def _sleep_flood(e: FloodWaitError) -> None:
    wait = min(e.seconds + 1, 600)
    logger.warning("Flood wait %ss, sleeping %ss", e.seconds, wait)
    await asyncio.sleep(wait)


async def backfill_chat(client, dialog, force: bool = False, skip_media: bool = False) -> int:
    chat_id = dialog.id
    entity = dialog.entity
    db.upsert_chat(chat_id, dialog.name or "Unknown", canonical_chat_type(entity), **chat_metadata(entity))
    is_forum = bool(getattr(entity, "forum", False))
    chat_folder = get_chat_folder(chat_id, dialog.name)

    min_id = 0 if force else db.get_last_synced_message_id(chat_id)
    count = 0
    highest_seen = min_id

    logger.info("  %s: starting from id > %s", dialog.name, min_id)

    flood_retries = 0
    async for message in client.iter_messages(dialog, min_id=min_id, reverse=True):
        try:
            row = await build_message_row(chat_id, message, client)

            if row["media_type"] is not None and settings.download_media and not skip_media:
                file_path = await download_with_retry(
                    message, settings.media_dir, chat_id,
                    chat_folder=chat_folder, sender_name=row["sender_name"],
                )
                if file_path:
                    row["file_path"] = file_path

            db.insert_message(**row)
            if is_forum and row["topic_id"] is not None:
                db.upsert_topic(chat_id, row["topic_id"], last_message_id=message.id, **(extract_topic_create(message) or {}))
            highest_seen = max(highest_seen, message.id)
            count += 1
            flood_retries = 0

            if count % 500 == 0:
                db.set_last_synced_message_id(chat_id, highest_seen)
                db.commit()
                logger.info("  %s: %s messages so far", dialog.name, count)

        except FloodWaitError as e:
            flood_retries += 1
            if flood_retries > MAX_FLOOD_RETRIES:
                logger.error("  %s: too many flood waits, stopping this chat", dialog.name)
                break
            await _sleep_flood(e)
        except Exception:
            logger.exception("  %s: error on message %s, skipping message", dialog.name, message.id)
            continue

    db.set_last_synced_message_id(chat_id, highest_seen)
    db.commit()
    return count


async def download_missing_media_chat(client, dialog) -> int:
    """Download media by iterating chat messages — stable unlike per-message get_messages."""
    chat_id = dialog.id
    chat_folder = get_chat_folder(chat_id, dialog.name)
    rows = db.get_messages_missing_media(chat_id)
    rows = [r for r in rows if r[1] in DOWNLOADABLE_MEDIA_TYPES]
    if not rows:
        return 0

    needed = {row[0]: row[2] or "Unknown User" for row in rows}
    logger.info("  %s: %s messages missing media", dialog.name, len(needed))
    count = 0
    total_needed = len(needed)

    BATCH = 100
    ids = list(needed.keys())
    for i in range(0, len(ids), BATCH):
        batch = ids[i:i + BATCH]
        try:
            messages = await client.get_messages(dialog, ids=batch)
            if not isinstance(messages, list):
                messages = [messages]
            for message in messages:
                if message is None or message.id not in needed:
                    continue
                sender_name = needed.pop(message.id)
                try:
                    file_path = await download_with_retry(
                        message, settings.media_dir, chat_id,
                        chat_folder=chat_folder, sender_name=sender_name,
                    )
                    if file_path:
                        file_name, file_size = document_meta(message)
                        db.update_message_file_path(chat_id, message.id, file_path, file_name=file_name, file_size=file_size)
                        count += 1
                except FloodWaitError as e:
                    await _sleep_flood(e)
                except Exception:
                    logger.exception("  %s: failed download msg %s", dialog.name, message.id)
            db.commit()
            if count % 50 == 0 and count > 0:
                logger.info("  %s: downloaded %s/%s media", dialog.name, count, total_needed)
        except FloodWaitError as e:
            await _sleep_flood(e)
        except Exception:
            logger.exception("  %s: batch error at offset %s", dialog.name, i)

    db.commit()
    return count


async def run_backfill(
    force: bool = False,
    chat_id: int | None = None,
    skip_media: bool = False,
) -> None:
    client = build_client(session_suffix="_backfill")
    await start_client(client)
    try:
        async for dialog in client.iter_dialogs():
            if chat_id is not None and dialog.id != chat_id:
                continue

            logger.info("Backfilling: %s (id=%s)", dialog.name, dialog.id)
            try:
                count = await backfill_chat(client, dialog, force=force, skip_media=skip_media)
                logger.info("Done: %s (%s new messages)", dialog.name, count)
            except FloodWaitError as e:
                await _sleep_flood(e)
                try:
                    count = await backfill_chat(client, dialog, force=force, skip_media=skip_media)
                    logger.info("Done (retry): %s (%s new messages)", dialog.name, count)
                except Exception:
                    logger.exception("Failed to backfill %s after flood retry", dialog.name)
            except Exception:
                logger.exception("Failed to backfill chat: %s", dialog.name)
    finally:
        try:
            await client.disconnect()
        except Exception:
            logger.warning("Disconnect failed (session lock held by listener), ignoring")

    logger.info("Backfill complete.")


async def run_media_download(
    chat_id: int | None = None,
) -> None:
    """Second pass: download media for messages that are missing it."""
    client = build_client(session_suffix="_media")
    await start_client(client)
    try:
        async for dialog in client.iter_dialogs():
            if chat_id is not None and dialog.id != chat_id:
                continue

            rows = db.get_messages_missing_media(dialog.id)
            if not rows:
                continue

            logger.info("Downloading media: %s (%s messages)", dialog.name, len(rows))
            try:
                count = await download_missing_media_chat(client, dialog)
                logger.info("Done media: %s (%s files)", dialog.name, count)
            except FloodWaitError as e:
                await _sleep_flood(e)
            except Exception:
                logger.exception("Failed media download for: %s", dialog.name)
    finally:
        try:
            await client.disconnect()
        except Exception:
            logger.warning("Disconnect failed (session lock held by listener), ignoring")

    logger.info("Media download complete.")


if __name__ == "__main__":
    asyncio.run(run_backfill())
