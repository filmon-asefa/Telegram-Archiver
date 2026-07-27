"""Human-readable, chronological media storage helpers.

Layout::

    media/YYYY/<Month Name (MM)>/DD/<Chat Name> [<chat_id>]/<media_type>/
        HH-MM-SS_<Sender Name>_message_<id>.<ext>

All paths are relative to the configured ``MEDIA_DIR`` root.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_FORBIDDEN_CHARS = re.compile(r'[<>:"/\\|?*]')
_MULTI_SPACE = re.compile(r'\s+')

MONTH_NAMES: dict[int, str] = {
    1: "January",
    2: "February",
    3: "March",
    4: "April",
    5: "May",
    6: "June",
    7: "July",
    8: "August",
    9: "September",
    10: "October",
    11: "November",
    12: "December",
}

MEDIA_TYPES: tuple[str, ...] = (
    "photos",
    "videos",
    "voice",
    "documents",
    "audio",
    "stickers",
    "animations",
    "contacts",
    "locations",
    "polls",
    "other",
)

_MAX_NAME_LEN = 80


def sanitize_name(name: str) -> str:
    """Remove forbidden characters and normalize whitespace for file-system names.

    Rules:
    - Remove ``< > : " / \\ | ? *``
    - Trim leading/trailing whitespace
    - Collapse multiple spaces into one
    - Remove trailing dots
    - Limit to 80 characters
    - Replace empty result with ``Unknown User``
    """
    name = _FORBIDDEN_CHARS.sub("", name)
    name = _MULTI_SPACE.sub(" ", name).strip()
    name = name.rstrip(".")
    if len(name) > _MAX_NAME_LEN:
        name = name[:_MAX_NAME_LEN].rstrip()
    return name or "Unknown User"


def get_chat_folder(chat_id: int, chat_name: str | None) -> str:
    """Return ``'Chat Name [<chat_id>]'`` or ``'Chat Name [self]'`` for Saved Messages."""
    name = sanitize_name(chat_name or "Unknown User")
    if chat_id == 777000:
        return f"{name} [self]"
    return f"{name} [{chat_id}]"


def get_month_folder(message_date: datetime) -> str:
    """Return ``'July (07)'`` style folder name for a datetime."""
    return f"{MONTH_NAMES[message_date.month]} ({message_date.month:02d})"


def get_media_directory(
    media_dir: Path,
    message_date: datetime,
    media_type: str,
    chat_folder: str | None = None,
) -> Path:
    """Return and create the full directory for a specific day + chat + media type.

    ``media/YYYY/<Month Name (MM)>/DD/<Chat Name> [<chat_id>]/<media_type>/``
    """
    if media_type not in MEDIA_TYPES:
        media_type = "other"
    parts = [
        media_dir,
        str(message_date.year),
        get_month_folder(message_date),
        f"{message_date.day:02d}",
    ]
    if chat_folder:
        parts.append(chat_folder)
    parts.append(media_type)
    day_dir = Path(*parts)
    day_dir.mkdir(parents=True, exist_ok=True)
    logger.debug("[MEDIA] Creating directory:\n%s", day_dir)
    return day_dir


def generate_filename(
    message_id: int,
    message_date: datetime,
    sender_name: str = "Unknown User",
    extension: str = "",
) -> str:
    """Build ``HH-MM-SS_<Sender>_message_<id>.<ext>`` filename."""
    sender = sanitize_name(sender_name)
    base = f"{message_date.strftime('%H-%M-%S')}_{sender}_message_{message_id}"
    return f"{base}{extension}" if extension else base


def ensure_unique_filename(path: Path) -> Path:
    """If *path* already exists, append ``_1``, ``_2``, ... before the extension."""
    if not path.exists():
        return path

    stem = path.stem
    suffix = path.suffix
    parent = path.parent
    counter = 1
    while True:
        candidate = parent / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            logger.debug("[MEDIA] Filename collision, using: %s", candidate.name)
            return candidate
        counter += 1


def get_storage_path(
    media_dir: Path,
    message_id: int,
    message_date: datetime,
    media_type: str,
    extension: str = "",
    chat_folder: str | None = None,
    sender_name: str = "Unknown User",
) -> Path:
    """Full, unique destination path for a media file.

    Creates the directory tree and guarantees no overwrites.
    """
    media_type = media_type if media_type in MEDIA_TYPES else "other"
    dest_dir = get_media_directory(media_dir, message_date, media_type, chat_folder)
    filename = generate_filename(message_id, message_date, sender_name, extension)
    return ensure_unique_filename(dest_dir / filename)


def move_existing_media(src: Path, dest: Path) -> Path:
    """Move *src* to *dest*, never overwriting.  Returns final path."""
    import shutil

    dest = ensure_unique_filename(dest)
    if src.resolve() == dest.resolve():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dest))
    logger.debug("[MEDIA] Moved %s -> %s", src.name, dest)
    return dest


def detect_media_type_from_path(path: Path) -> str:
    """Infer a media-type folder name from a file extension."""
    ext = path.suffix.lower()
    _MAP: dict[str, str] = {
        ".jpg": "photos",
        ".jpeg": "photos",
        ".png": "photos",
        ".gif": "photos",
        ".bmp": "photos",
        ".tiff": "photos",
        ".mp4": "videos",
        ".mov": "videos",
        ".avi": "videos",
        ".mkv": "videos",
        ".webm": "videos",
        ".flv": "videos",
        ".wmv": "videos",
        ".ogg": "voice",
        ".oga": "voice",
        ".opus": "voice",
        ".amr": "voice",
        ".mp3": "audio",
        ".m4a": "audio",
        ".flac": "audio",
        ".wav": "audio",
        ".aac": "audio",
        ".pdf": "documents",
        ".doc": "documents",
        ".docx": "documents",
        ".xls": "documents",
        ".xlsx": "documents",
        ".ppt": "documents",
        ".pptx": "documents",
        ".txt": "documents",
        ".csv": "documents",
        ".rtf": "documents",
        ".zip": "documents",
        ".rar": "documents",
        ".7z": "documents",
        ".json": "documents",
        ".js": "documents",
        ".py": "documents",
        ".tgs": "stickers",
        ".webp": "stickers",
    }
    return _MAP.get(ext, "other")
