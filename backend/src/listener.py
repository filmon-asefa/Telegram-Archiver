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
from telethon.errors import FloodWaitError
from telethon.tl import types

from . import db
from .config import settings
from .reconcile_media import reconcile_media
from .sse_server import broadcast, start_sse_server
from .telegram_client import (
    build_client,
    canonical_chat_type,
    chat_metadata,
    classify_media,
    download_with_retry,
    extract_forward_info,
    extract_topic_create,
    extract_topic_id,
    get_media_duration,
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
        def _write():
            db.update_message_file_path(chat_id, message.id, path)
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

            sender_id, sender_name = await sender_display_name(message, is_outgoing=bool(message.out))
            media_type = classify_media(message)
            fwd = await extract_forward_info(message, client)

            _cid, _mid = chat_id, message.id
            _sid, _sname = sender_id, sender_name
            _out = bool(message.out)
            _date = int(message.date.timestamp())
            _text = message.text
            _mtype = media_type
            _chat_type = canonical_chat_type(chat)
            _reply_to = getattr(message, "reply_to_msg_id", None)
            _duration = get_media_duration(message)
            _group_id = getattr(message, "grouped_id", None)
            _topic_id = extract_topic_id(message)
            _topic_create = extract_topic_create(message)
            _is_forum = bool(getattr(chat, "forum", False))

            def _write():
                db.upsert_chat(_cid, chat_name, _chat_type, **chat_metadata(chat))
                db.insert_message(
                    chat_id=_cid,
                    message_id=_mid,
                    sender_id=_sid,
                    sender_name=_sname,
                    is_outgoing=_out,
                    date_unix=_date,
                    text=_text,
                    media_type=_mtype,
                    file_path=None,
                    media_duration=_duration,
                    media_group_id=_group_id,
                    reply_to_message_id=_reply_to,
                    topic_id=_topic_id,
                    **fwd,
                )
                if _is_forum and _topic_id is not None:
                    db.upsert_topic(_cid, _topic_id, last_message_id=_mid, **(_topic_create or {}))
                db.set_last_synced_message_id(_cid, _mid)
                db.commit()

            _with_db_retry(_write)
            logger.info("Saved message chat=%s id=%s type=%s out=%s", chat_id, message.id, media_type or "text", _out)

            broadcast("new_message", {
                "chat_id": chat_id,
                "message_id": message.id,
                "sender_id": sender_id,
                "sender_name": sender_name,
                "is_outgoing": _out,
                "date_unix": _date,
                "text": _text,
                "media_type": media_type,
                "file_path": None,
                "media_duration": _duration,
                "media_group_id": _group_id,
                "is_forward": fwd.get("is_forward", False),
                "fwd_from_author": fwd.get("fwd_from_author"),
                "reply_to_message_id": _reply_to,
                "topic_id": _topic_id,
            })

            if media_type is not None and settings.download_media:
                asyncio.create_task(_download_and_attach(message, chat_id, chat_folder, sender_name))
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

            chat_id = event.chat_id
            if chat_id is None:
                update = getattr(event, 'original_update', None)
                if update:
                    peer = getattr(update, 'peer', None)
                    if peer:
                        chat_id = get_peer_id(peer)
                    elif hasattr(update, 'channel_id') and update.channel_id:
                        chat_id = int(f"-100{update.channel_id}")

            if chat_id is None:
                msg_id = event.deleted_ids[0]
                row = db.get_connection().execute(
                    "SELECT DISTINCT chat_id FROM messages WHERE message_id = ? LIMIT 1",
                    (msg_id,),
                ).fetchone()
                if row:
                    chat_id = row[0]
                    logger.info("Resolved chat_id=%s from DB for deleted msg %s", chat_id, msg_id)

            if chat_id is None:
                logger.warning("MessageDeleted event without chat_id, skipped ids=%s", event.deleted_ids)
                return

            def _write_del():
                for msg_id in event.deleted_ids:
                    db.save_message_snapshot(chat_id, msg_id)
                    db.record_deletion(chat_id, msg_id)
                    logger.info("Deletion recorded chat=%s id=%s", chat_id, msg_id)
                db.commit()

            _with_db_retry(_write_del)
            for msg_id in event.deleted_ids:
                broadcast("message_delete", {"chat_id": chat_id, "message_id": msg_id})
        except Exception:
            logger.exception("Error in MessageDeleted handler for chat=%s", event.chat_id)


async def _initial_backfill(client) -> None:
    """Backfill text for all chats, then download missing media."""
    logger.info("=== Initial backfill: text for all chats ===")
    async for dialog in client.iter_dialogs():
        chat_id = dialog.id
        chat_name = dialog.name or "Unknown"
        last_synced = db.get_last_synced_message_id(chat_id)

        if last_synced > 0:
            logger.info("  %s: already synced to id=%s, catching up...", chat_name, last_synced)
        else:
            logger.info("  %s: new chat, backfilling from start...", chat_name)

        chat_folder = get_chat_folder(chat_id, chat_name)
        entity = dialog.entity
        db.upsert_chat(chat_id, chat_name, canonical_chat_type(entity), **chat_metadata(entity))
        is_forum = bool(getattr(entity, "forum", False))

        count = 0
        highest_seen = last_synced
        flood_retries = 0

        try:
            async for message in client.iter_messages(dialog, min_id=last_synced, reverse=True):
                try:
                    sender_id, sender_name = await sender_display_name(message, is_outgoing=bool(message.out))
                    media_type = classify_media(message)
                    fwd = await extract_forward_info(message, client)
                    topic_id = extract_topic_id(message)
                    topic_create = extract_topic_create(message)

                    db.insert_message(
                        chat_id=chat_id,
                        message_id=message.id,
                        sender_id=sender_id,
                        sender_name=sender_name,
                        is_outgoing=bool(message.out),
                        date_unix=int(message.date.timestamp()),
                        text=message.text,
                        media_type=media_type,
                        file_path=None,
                        media_duration=get_media_duration(message),
                        media_group_id=getattr(message, "grouped_id", None),
                        reply_to_message_id=getattr(message, "reply_to_msg_id", None),
                        topic_id=topic_id,
                        **fwd,
                    )
                    if is_forum and topic_id is not None:
                        db.upsert_topic(chat_id, topic_id, last_message_id=message.id, **(topic_create or {}))
                    highest_seen = max(highest_seen, message.id)
                    count += 1
                    flood_retries = 0

                    if count % 500 == 0:
                        db.set_last_synced_message_id(chat_id, highest_seen)
                        db.commit()
                        logger.info("  %s: %s messages backfilled", chat_name, count)

                except FloodWaitError as e:
                    flood_retries += 1
                    if flood_retries > 5:
                        logger.error("  %s: too many flood waits, moving on", chat_name)
                        break
                    wait = min(e.seconds + 1, 600)
                    logger.warning("  %s: flood wait %ss", chat_name, wait)
                    await asyncio.sleep(wait)
                except Exception:
                    logger.exception("  %s: error on message, skipping", chat_name)
                    continue

            db.set_last_synced_message_id(chat_id, highest_seen)
            db.commit()
            if count > 0:
                logger.info("  %s: backfill done (%s new messages)", chat_name, count)
        except Exception:
            logger.exception("  %s: failed to backfill", chat_name)

    if settings.download_media:
        logger.info("=== Initial backfill: downloading missing media ===")
        async for dialog in client.iter_dialogs():
            chat_id = dialog.id
            chat_folder = get_chat_folder(chat_id, dialog.name)
            DOWNLOADABLE = {"photos", "videos", "voice", "documents", "audio", "stickers", "animations", "other"}
            rows = db.get_messages_missing_media(chat_id)
            rows = [r for r in rows if r[1] in DOWNLOADABLE]
            if not rows:
                continue

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
                                db.update_message_file_path(chat_id, message.id, file_path)
                                count += 1
                        except FloodWaitError as e:
                            wait = min(e.seconds + 1, 600)
                            await asyncio.sleep(wait)
                        except Exception:
                            logger.exception("  %s: failed download msg %s", dialog.name, message.id)
                    db.commit()
                    if count % 50 == 0 and count > 0:
                        logger.info("  %s: downloaded %s/%s media", dialog.name, count, total_needed)
                except FloodWaitError as e:
                    wait = min(e.seconds + 1, 600)
                    await asyncio.sleep(wait)
                except Exception:
                    logger.exception("  %s: batch error at offset %s", dialog.name, i)

            db.commit()
            logger.info("  %s: media done (%s files)", dialog.name, count)

    logger.info("=== Initial backfill complete ===")


async def _catchup_loop(client) -> None:
    """Periodically: backfill any new chats and download missing media."""
    while True:
        await asyncio.sleep(CATCHUP_INTERVAL)
        try:
            logger.info("=== Catch-up cycle starting ===")

            async for dialog in client.iter_dialogs():
                chat_id = dialog.id
                last_synced = db.get_last_synced_message_id(chat_id)
                if last_synced == 0:
                    continue

                chat_folder = get_chat_folder(chat_id, dialog.name)
                entity = dialog.entity
                db.upsert_chat(chat_id, dialog.name or "Unknown", canonical_chat_type(entity), **chat_metadata(entity))
                is_forum = bool(getattr(entity, "forum", False))
                count = 0
                highest_seen = last_synced
                async for message in client.iter_messages(dialog, min_id=last_synced, reverse=True):
                    try:
                        sender_id, sender_name = await sender_display_name(message, is_outgoing=bool(message.out))
                        media_type = classify_media(message)
                        fwd = await extract_forward_info(message, client)
                        topic_id = extract_topic_id(message)
                        topic_create = extract_topic_create(message)
                        db.insert_message(
                            chat_id=chat_id,
                            message_id=message.id,
                            sender_id=sender_id,
                            sender_name=sender_name,
                            is_outgoing=bool(message.out),
                            date_unix=int(message.date.timestamp()),
                            text=message.text,
                            media_type=media_type,
                            file_path=None,
                            media_duration=get_media_duration(message),
                            media_group_id=getattr(message, "grouped_id", None),
                            reply_to_message_id=getattr(message, "reply_to_msg_id", None),
                            topic_id=topic_id,
                            **fwd,
                        )
                        if is_forum and topic_id is not None:
                            db.upsert_topic(chat_id, topic_id, last_message_id=message.id, **(topic_create or {}))
                        highest_seen = max(highest_seen, message.id)
                        count += 1
                        if count % 200 == 0:
                            db.set_last_synced_message_id(chat_id, highest_seen)
                            db.commit()
                    except FloodWaitError:
                        break
                    except Exception:
                        continue

                if count > 0:
                    db.set_last_synced_message_id(chat_id, highest_seen)
                    db.commit()
                    logger.info("  %s: caught up %s messages", dialog.name, count)

                if settings.download_media:
                    DOWNLOADABLE = {"photos", "videos", "voice", "documents", "audio", "stickers", "animations", "other"}
                    rows = db.get_messages_missing_media(chat_id)
                    rows = [r for r in rows if r[1] in DOWNLOADABLE]
                    if rows:
                        needed = {row[0]: row[2] or "Unknown User" for row in rows}
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
                                            db.update_message_file_path(chat_id, message.id, file_path)
                                    except FloodWaitError:
                                        break
                                    except Exception:
                                        continue
                                db.commit()
                            except FloodWaitError:
                                break
                            except Exception:
                                continue

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
