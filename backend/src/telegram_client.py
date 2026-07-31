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


def get_media_duration(message: Message) -> Optional[int]:
    """Return the media duration in seconds for voice/audio/video media, else None."""
    for attr in ("voice", "video", "video_note", "audio"):
        obj = getattr(message, attr, None)
        if obj is not None and getattr(obj, "duration", None):
            try:
                return int(obj.duration)
            except (TypeError, ValueError):
                return None
    return None


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
    max_retries: int = 5,
) -> Optional[str]:
    """Download media for a message, retrying on flood waits and transient failures. Returns local path or None."""
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
                timeout=180,
            )
            if path:
                logger.info("[MEDIA] Saved:\n%s", path)
            return path
        except asyncio.TimeoutError:
            logger.warning("Timeout downloading media (attempt %s/%s)", attempt, max_retries)
        except FloodWaitError as e:
            logger.warning("Flood wait %ss downloading media (attempt %s/%s)", e.seconds, attempt, max_retries)
            await asyncio.sleep(e.seconds + 1)
        except Exception:  # noqa: BLE001 - media download failures shouldn't crash the run
            logger.exception("Failed to download media for chat=%s message=%s (attempt %s/%s)", chat_id, message.id, attempt, max_retries)
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


async def extract_forward_info(message: Message, client: TelegramClient | None = None) -> dict:
    """Extract forward metadata from a message.

    Returns a dict with keys: is_forward, fwd_from_chat_id, fwd_from_msg_id,
    fwd_from_date, fwd_from_author. All values default to None when
    the message is not a forward.

    When ``post_author`` is not set (most forwards) and *client* is
    provided, the function will resolve the original sender/chat name
    from ``from_id``.
    """
    fwd = message.fwd_from
    if fwd is None:
        return {
            "is_forward": False,
            "fwd_from_chat_id": None,
            "fwd_from_msg_id": None,
            "fwd_from_date": None,
            "fwd_from_author": None,
        }

    from telethon.utils import get_peer_id

    author = fwd.post_author
    if author is None and client is not None and fwd.from_id is not None:
        try:
            entity = await client.get_entity(fwd.from_id)
            first = getattr(entity, "first_name", None) or ""
            last = getattr(entity, "last_name", None) or ""
            author = f"{first} {last}".strip() or getattr(entity, "title", None) or getattr(entity, "username", None)
        except Exception:
            pass

    return {
        "is_forward": True,
        "fwd_from_chat_id": get_peer_id(fwd.from_id) if fwd.from_id else None,
        "fwd_from_msg_id": fwd.channel_post,
        "fwd_from_date": int(fwd.date.timestamp()) if fwd.date else None,
        "fwd_from_author": author,
    }
