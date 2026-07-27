"""Shared Telethon client and helpers for turning a Message into a DB row."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional, Tuple

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.custom.message import Message

from .config import settings
from .utils.media_storage import get_storage_path

logger = logging.getLogger(__name__)


def classify_media(message: Message) -> Optional[str]:
    """Determine the media-type folder for *message*.

    Returns one of the canonical folder names (``photos``, ``videos``,
    ``voice``, ``documents``, ``audio``, ``stickers``, ``animations``,
    ``contacts``, ``locations``, ``polls``) or ``other`` / ``None`` for
    text-only messages.
    """
    if message.photo:
        return "photos"
    if message.video or message.video_note:
        return "videos"
    if message.voice:
        return "voice"
    if message.audio:
        return "audio"
    if message.document:
        # Distinguish sticker/animations tgs from regular documents
        name = getattr(message.document, "file_name", "") or ""
        if name.endswith(".tgs"):
            return "stickers"
        if message.document.mime_type == "application/json" and name.endswith(".tgs"):
            return "stickers"
        if message.gif or name.endswith(".gif"):
            return "animations"
        return "documents"
    if message.sticker:
        return "stickers"
    if message.contact:
        return "contacts"
    if message.geo:
        return "locations"
    if message.poll:
        return "polls"
    if message.text:
        return None
    return "other"


def build_client(session_suffix: str = "") -> TelegramClient:
    name = settings.session_name + session_suffix
    return TelegramClient(name, settings.api_id, settings.api_hash)


async def start_client(client: TelegramClient) -> None:
    """Connect and authenticate, prompting for the login code on first run only."""
    await client.start(phone=settings.phone)  # type: ignore[arg-type]
    me = await client.get_me()
    logger.info("Logged in as %s (id=%s)", getattr(me, "username", None) or me.first_name, me.id)


async def download_with_retry(
    message: Message, media_dir: Path, chat_id: int,
    chat_folder: str | None = None, sender_name: str = "Unknown User",
    max_retries: int = 3,
) -> Optional[str]:
    """Download media for a message, retrying on flood waits. Returns local path or None."""
    media_type = classify_media(message) or "other"
    logger.info("[MEDIA] Sender:\n%s", sender_name)
    dest = get_storage_path(
        media_dir, message.id, message.date, media_type,
        chat_folder=chat_folder, sender_name=sender_name,
    )

    logger.info("[MEDIA] Downloading %s…", media_type)
    for attempt in range(1, max_retries + 1):
        try:
            path = await asyncio.wait_for(
                message.download_media(file=str(dest)),
                timeout=120,
            )
            if path:
                logger.info("[MEDIA] Saved:\n%s", path)
            return path
        except asyncio.TimeoutError:
            logger.warning("Timeout downloading media (attempt %s), skipping", attempt)
            return None
        except FloodWaitError as e:
            logger.warning("Flood wait %ss downloading media (attempt %s)", e.seconds, attempt)
            await asyncio.sleep(e.seconds + 1)
        except Exception:  # noqa: BLE001 - media download failures shouldn't crash the run
            logger.exception("Failed to download media for chat=%s message=%s", chat_id, message.id)
            return None
    logger.error("Giving up on media download for chat=%s message=%s", chat_id, message.id)
    return None


async def sender_display_name(message: Message, is_outgoing: bool = False) -> Tuple[Optional[int], str]:
    """Return (sender_id, display_name) for a message.

    Priority: first+last name → username → phone → 'Me' (outgoing) → 'Unknown User'.
    """
    sender = await message.get_sender()
    if sender is None:
        if is_outgoing:
            return message.sender_id, "Me"
        return message.sender_id, "Unknown User"

    # Build name from first + last
    first = getattr(sender, "first_name", None) or ""
    last = getattr(sender, "last_name", None) or ""
    name = f"{first} {last}".strip()

    # Fallback to username
    if not name:
        name = getattr(sender, "username", None) or ""

    # Fallback to phone
    if not name:
        phone = getattr(sender, "phone", None) or ""
        name = phone

    # Fallback for outgoing
    if not name and is_outgoing:
        name = "Me"

    # Final fallback
    if not name:
        name = "Unknown User"

    return message.sender_id, name
