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

# Media kinds that are saved as files on disk (the rest — contacts, locations,
# polls — are display-only and never downloaded).
DOWNLOADABLE_MEDIA_TYPES = frozenset({
    "photos", "videos", "voice", "documents", "audio",
    "stickers", "animations", "other",
})


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


def entity_display_name(entity) -> str:
    """Return a display name for any Telethon entity (user or chat).

    Priority: first+last name → chat title → username → phone.
    """
    if entity is None:
        return ""
    first = getattr(entity, "first_name", None) or ""
    last = getattr(entity, "last_name", None) or ""
    name = f"{first} {last}".strip()
    if not name:
        name = getattr(entity, "title", None) or ""
    if not name:
        name = getattr(entity, "username", None) or ""
    if not name:
        name = getattr(entity, "phone", None) or ""
    return name


async def sender_display_name(message: Message, is_outgoing: bool = False) -> Tuple[Optional[int], str]:
    """Return (sender_id, display_name) for a message.

    Priority: first+last name → title → username → phone → 'Me' (outgoing) → 'Unknown User'.
    """
    sender = await message.get_sender()
    if sender is None:
        if is_outgoing:
            return message.sender_id, "Me"
        return message.sender_id, "Unknown User"

    name = entity_display_name(sender)
    if not name and is_outgoing:
        name = "Me"
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


def document_meta(message: Message) -> Tuple[Optional[str], Optional[int]]:
    """Return the original (file_name, file_size) for a document, else (None, None)."""
    from telethon.tl.types import DocumentAttributeFilename

    doc = getattr(message, "document", None)
    if doc is None:
        return None, None
    size = getattr(doc, "size", None)
    for attr in getattr(doc, "attributes", None) or []:
        if isinstance(attr, DocumentAttributeFilename):
            return attr.file_name or None, (int(size) if size else None)
    return None, (int(size) if size else None)


def extract_topic_id(message: Message) -> Optional[int]:
    """Return the forum topic root message id for *message*, or None.

    Only messages posted inside a forum topic carry ``reply_to_top_id``.
    Messages in the General topic (or a non-forum chat) return None.
    Topic-creation messages are their own root, so their id is returned.
    """
    from telethon.tl.types import MessageActionTopicCreate

    action = getattr(message, "action", None)
    if isinstance(action, MessageActionTopicCreate):
        return message.id
    reply_to = getattr(message, "reply_to", None)
    if reply_to is None:
        return None
    return getattr(reply_to, "reply_to_top_id", None)


def extract_topic_create(message: Message) -> Optional[dict]:
    """Return topic metadata when *message* is a topic-creation service message.

    Returns dict with keys: title, icon_color, icon_emoji_id, created_at_unix.
    """
    from telethon.tl.types import MessageActionTopicCreate

    action = getattr(message, "action", None)
    if not isinstance(action, MessageActionTopicCreate):
        return None
    return {
        "title": getattr(action, "title", None),
        "icon_color": getattr(action, "icon_color", None),
        "icon_emoji_id": getattr(action, "icon_emoji_id", None),
        "created_at_unix": int(message.date.timestamp()) if message.date else None,
    }


def canonical_chat_type(entity) -> str:
    """Map a Telethon entity to a canonical chat type.

    Returns one of: 'user' | 'bot' | 'group' | 'supergroup' | 'channel' | 'forum'.
    Forbidden entity types fall back to the closest allowed value.
    """
    class_name = entity.__class__.__name__.lower()
    if class_name in ("chat", "chatforbidden", "chatinviter"):
        return "group"
    if class_name == "user":
        return "bot" if getattr(entity, "bot", False) else "user"
    if class_name == "channel":
        if getattr(entity, "forum", False):
            return "forum"
        if getattr(entity, "megagroup", False):
            return "supergroup"
        return "channel"
    if class_name == "channelforbidden":
        return "channel"
    return class_name


def chat_metadata(entity) -> dict:
    """Extract optional metadata for the chats table from a Telethon entity."""
    return {
        "username": getattr(entity, "username", None),
        "description": getattr(entity, "about", None),
        "participant_count": getattr(entity, "participants_count", None),
        "megagroup": bool(getattr(entity, "megagroup", False)),
        "broadcast": bool(getattr(entity, "broadcast", False)),
        "is_verified": bool(getattr(entity, "verified", False)),
        "forum": bool(getattr(entity, "forum", False)),
        "gigagroup": bool(getattr(entity, "gigagroup", False)),
    }


async def build_message_row(
    chat_id: int,
    message: Message,
    client: TelegramClient | None = None,
    file_path: str | None = None,
) -> dict:
    """Compute every column for ``db.insert_message`` from a Telethon Message.

    This is the single source of truth for the message→DB-row mapping used by
    the backfill and listener paths.
    """
    sender_id, sender_name = await sender_display_name(message, is_outgoing=bool(message.out))
    file_name, file_size = document_meta(message)
    return {
        "chat_id": chat_id,
        "message_id": message.id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "is_outgoing": bool(message.out),
        "date_unix": int(message.date.timestamp()),
        "text": message.text,
        "media_type": classify_media(message),
        "file_path": file_path,
        "media_duration": get_media_duration(message),
        "media_group_id": getattr(message, "grouped_id", None),
        "reply_to_message_id": getattr(message, "reply_to_msg_id", None),
        "topic_id": extract_topic_id(message),
        "file_name": file_name,
        "file_size": file_size,
        "pinned": bool(getattr(message, "pinned", False)),
        **await extract_forward_info(message, client),
    }
