"""Persistent daemon: backfills history, then listens forever.

After initial backfill, the daemon:
- Listens for new messages in real-time
- Periodically catches up on any missed chats
- Periodically downloads missing media
- Never exits
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
import time

from telethon import events

from . import db
from .backfill import backfill_chat, download_missing_media_chat
from .config import settings
from .reconcile_media import reconcile_media
from .sse_server import broadcast, start_sse_server
from .telegram_client import (
    build_client,
    build_message_row,
    canonical_chat_type,
    chat_metadata,
    classify_media,
    download_with_retry,
    document_meta,
    extract_topic_create,
    sender_display_name,
    start_client,
)
from .utils.media_storage import get_chat_folder

logger = logging.getLogger(__name__)

MAX_DB_RETRIES = 10
DB_RETRY_DELAY = 0.5
CATCHUP_INTERVAL = 1800


def _with_db_retry(fn):
    for attempt in range(MAX_DB_RETRIES):
        try:
            fn()
            return
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e) and attempt < MAX_DB_RETRIES - 1:
                logger.debug("DB locked, retrying in %ss (attempt %d/%d)", DB_RETRY_DELAY, attempt + 1, MAX_DB_RETRIES)
                time.sleep(DB_RETRY_DELAY * (attempt + 1))
            else:
                raise


async def _download_and_attach(
    message, chat_id: int, chat_folder: str, sender_name: str,
) -> None:
    path = await download_with_retry(
        message, settings.media_dir, chat_id,
        chat_folder=chat_folder, sender_name=sender_name,
    )
    if path:
        file_name, file_size = document_meta(message)

        def _write():
            db.update_message_file_path(chat_id, message.id, path, file_name=file_name, file_size=file_size)
            db.commit()
        _with_db_retry(_write)
        broadcast("media_ready", {"chat_id": chat_id, "message_id": message.id, "file_path": path})


def register_handlers(client) -> None:
    @client.on(events.NewMessage(outgoing=True, incoming=True))
    async def handler(event) -> None:
        try:
            message = event.message
            chat_id = event.chat_id

            chat = await event.get_chat()
            chat_name = getattr(chat, "title", None) or getattr(chat, "first_name", "Unknown")
            chat_folder = get_chat_folder(chat_id, chat_name)
            chat_type = canonical_chat_type(chat)
            is_forum = bool(getattr(chat, "forum", False))

            row = await build_message_row(chat_id, message, client)
            topic_create = extract_topic_create(message)

            def _write():
                db.upsert_chat(chat_id, chat_name, chat_type, **chat_metadata(chat))
                db.insert_message(**row)
                if is_forum and row["topic_id"] is not None:
                    db.upsert_topic(chat_id, row["topic_id"], last_message_id=message.id, **(topic_create or {}))
                db.set_last_synced_message_id(chat_id, message.id)
                db.commit()

            _with_db_retry(_write)
            logger.info("Saved message chat=%s id=%s type=%s out=%s", chat_id, message.id, row["media_type"] or "text", row["is_outgoing"])

            broadcast("new_message", {
                "chat_id": chat_id,
                "message_id": message.id,
                "sender_id": row["sender_id"],
                "sender_name": row["sender_name"],
                "is_outgoing": row["is_outgoing"],
                "date_unix": row["date_unix"],
                "text": row["text"],
                "media_type": row["media_type"],
                "file_path": None,
                "file_name": row["file_name"],
                "file_size": row["file_size"],
                "media_duration": row["media_duration"],
                "media_group_id": row["media_group_id"],
                "is_forward": row["is_forward"],
                "fwd_from_author": row["fwd_from_author"],
                "reply_to_message_id": row["reply_to_message_id"],
                "topic_id": row["topic_id"],
            })

            if row["media_type"] is not None and settings.download_media:
                asyncio.create_task(_download_and_attach(message, chat_id, chat_folder, row["sender_name"]))
        except Exception:
            logger.exception("Error in NewMessage handler for chat=%s msg=%s", event.chat_id, getattr(event.message, 'id', '?'))

    @client.on(events.MessageEdited)
    async def edit_handler(event) -> None:
        try:
            message = event.message
            chat_id = event.chat_id
            message_id = message.id

            sender_id, sender_name = await sender_display_name(message, is_outgoing=bool(message.out))

            def _write_edit():
                conn = db.get_connection()
                row = conn.execute(
                    "SELECT text, sender_name FROM messages WHERE chat_id = ? AND message_id = ?",
                    (chat_id, message_id),
                ).fetchone()

                old_text = row[0] if row else None
                old_sender = row[1] if row else None
                new_text = message.text

                if old_text != new_text or old_sender != sender_name:
                    db.record_edit(chat_id, message_id, old_text, new_text)

                db.update_message_text(chat_id, message_id, new_text, sender_name)
                db.commit()

            _with_db_retry(_write_edit)

            broadcast("message_edit", {
                "chat_id": chat_id,
                "message_id": message_id,
                "new_text": message.text,
                "edited_at_unix": int(time.time()),
            })

            media_type = classify_media(message)
            if media_type:
                def _check_media():
                    return db.get_connection().execute(
                        "SELECT file_path FROM messages WHERE chat_id = ? AND message_id = ? AND file_path IS NOT NULL",
                        (chat_id, message_id),
                    ).fetchone()
                existing = _with_db_retry(_check_media) or None
                if not existing:
                    chat = await event.get_chat()
                    chat_name = getattr(chat, "title", None) or getattr(chat, "first_name", "Unknown")
                    chat_folder = get_chat_folder(chat_id, chat_name)
                    asyncio.create_task(_download_and_attach(message, chat_id, chat_folder, sender_name))

            logger.info("Edit recorded chat=%s id=%s", chat_id, message_id)
        except Exception:
            logger.exception("Error in MessageEdited handler for chat=%s msg=%s", event.chat_id, getattr(event.message, 'id', '?'))

    @client.on(events.MessageDeleted)
    async def delete_handler(event) -> None:
        try:
            from telethon.utils import get_peer_id

            deleted_ids = list(getattr(event, "deleted_ids", None) or [])

            chat_id = event.chat_id
            if chat_id is None:
                update = getattr(event, 'original_update', None)
                if update:
                    peer = getattr(update, 'peer', None)
                    if peer:
                        chat_id = get_peer_id(peer)
                    elif hasattr(update, 'channel_id') and update.channel_id:
                        chat_id = int(f"-100{update.channel_id}")

            if chat_id is None and deleted_ids:
                msg_id = deleted_ids[0]
                row = db.get_connection().execute(
                    "SELECT DISTINCT chat_id FROM messages WHERE message_id = ? LIMIT 1",
                    (msg_id,),
                ).fetchone()
                if row:
                    chat_id = row[0]
                    logger.info("Resolved chat_id=%s from DB for deleted msg %s", chat_id, msg_id)

            if chat_id is None or not deleted_ids:
                logger.warning("MessageDeleted event without chat_id, skipped ids=%s", deleted_ids)
                return

            def _write_del():
                for msg_id in deleted_ids:
                    db.save_message_snapshot(chat_id, msg_id)
                    db.record_deletion(chat_id, msg_id)
                    logger.info("Deletion recorded chat=%s id=%s", chat_id, msg_id)
                db.commit()

            _with_db_retry(_write_del)
            for msg_id in deleted_ids:
                broadcast("message_delete", {"chat_id": chat_id, "message_id": msg_id})
        except Exception:
            logger.exception("Error in MessageDeleted handler for chat=%s", event.chat_id)


async def _initial_backfill(client) -> None:
    """Backfill text for all chats, then download missing media."""
    logger.info("=== Initial backfill: text for all chats ===")
    async for dialog in client.iter_dialogs():
        chat_id = dialog.id
        last_synced = db.get_last_synced_message_id(chat_id)

        if last_synced > 0:
            logger.info("  %s: already synced to id=%s, catching up...", dialog.name, last_synced)
        else:
            logger.info("  %s: new chat, backfilling from start...", dialog.name)

        try:
            count = await backfill_chat(client, dialog, skip_media=True)
            if count > 0:
                logger.info("  %s: backfill done (%s new messages)", dialog.name, count)
        except Exception:
            logger.exception("  %s: failed to backfill", dialog.name)

    if settings.download_media:
        logger.info("=== Initial backfill: downloading missing media ===")
        async for dialog in client.iter_dialogs():
            try:
                count = await download_missing_media_chat(client, dialog)
                if count > 0:
                    logger.info("  %s: media done (%s files)", dialog.name, count)
            except Exception:
                logger.exception("  %s: failed media download", dialog.name)

    logger.info("=== Initial backfill complete ===")


async def _catchup_loop(client) -> None:
    """Periodically: backfill missed messages and download missing media."""
    while True:
        await asyncio.sleep(CATCHUP_INTERVAL)
        try:
            logger.info("=== Catch-up cycle starting ===")

            async for dialog in client.iter_dialogs():
                chat_id = dialog.id
                if db.get_last_synced_message_id(chat_id) == 0:
                    continue
                try:
                    count = await backfill_chat(client, dialog, skip_media=True)
                    if count > 0:
                        logger.info("  %s: caught up %s messages", dialog.name, count)
                    if settings.download_media:
                        await download_missing_media_chat(client, dialog)
                except Exception:
                    logger.exception("  %s: catch-up failed", dialog.name)

            logger.info("=== Catch-up cycle complete ===")
        except Exception:
            logger.exception("Catch-up cycle failed")


async def _heartbeat(client):
    while True:
        await asyncio.sleep(300)
        try:
            if not await client.is_user_authorized():
                logger.error("Client disconnected! Attempting reconnect...")
                await client.connect()
                await client.start(phone=settings.phone)
            else:
                logger.info("Heartbeat OK — listener alive")
        except Exception:
            logger.exception("Heartbeat check failed")


async def run_listener() -> None:
    try:
        summary = reconcile_media()
        logger.info("Media reconciliation: %s", summary)
    except Exception:
        logger.exception("Media reconciliation failed")

    await start_sse_server()

    client = build_client()
    await start_client(client)
    register_handlers(client)

    await _initial_backfill(client)

    logger.info("Listening for new messages. Press Ctrl+C to stop.")
    asyncio.create_task(_heartbeat(client))
    asyncio.create_task(_catchup_loop(client))
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(run_listener())
