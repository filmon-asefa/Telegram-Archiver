"""Move media files into human-readable date/chat/type folders with sender-named files.

Layout::

    media/YYYY/<Month Name (MM)>/DD/<Chat Name> [<chat_id>]/<media_type>/
        HH-MM-SS_<Sender Name>_message_<id>.<ext>

Invoke via: ``python -m src.main --reorganize-media``
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path

from . import db
from .config import settings
from .utils.media_storage import (
    MEDIA_TYPES,
    detect_media_type_from_path,
    get_chat_folder,
    get_storage_path,
    move_existing_media,
)

logger = logging.getLogger(__name__)

_FLAT_NAME = re.compile(r"^-?(\d+)_(\d+)(\..+)?$")
_SENDER_PATTERN = re.compile(r"^\d{2}-\d{2}-\d{2}_.+_message_\d+$")


def _is_new_layout(path: Path, media_dir: Path) -> bool:
    """True if *path* lives under the full new layout (with chat folder)."""
    try:
        rel = path.relative_to(media_dir)
    except ValueError:
        return False
    parts = rel.parts
    # New layout: YYYY/<Month>/DD/<Chat Name> [<id>]/<media_type>/file  (6+ parts)
    if len(parts) < 6:
        return False
    year = parts[0]
    month_part = parts[1]
    day = parts[2]
    # parts[3] is the chat folder — skip validation
    media_type = parts[4]
    return (
        len(year) == 4
        and year.isdigit()
        and "(" in month_part and month_part.endswith(")")
        and len(day) == 2
        and day.isdigit()
        and media_type in MEDIA_TYPES
    )


def _has_sender_in_filename(path: Path) -> bool:
    """True if the filename already contains a sender name (new format)."""
    return bool(_SENDER_PATTERN.match(path.stem))


def _resolve_source(file_path: str, chat_id: int, message_id: int) -> Path | None:
    """Find the source file on disk, trying common naming patterns."""
    src = Path(file_path)
    if not src.is_absolute():
        src = settings.media_dir / src.name if src.parent == Path(".") else src

    if src.exists():
        return src

    # Try flat naming pattern
    suffixes = "".join(src.suffixes) if src.suffixes else ""
    flat = settings.media_dir / f"{chat_id}_{message_id}{suffixes}"
    if flat.exists():
        return flat

    matches = list(settings.media_dir.glob(f"{chat_id}_{message_id}.*"))
    if matches:
        return matches[0]

    # Search recursively for the message_id in any layout
    for candidate in settings.media_dir.rglob(f"*_message_{message_id}.*"):
        if candidate.is_file():
            return candidate

    return None


def _infer_media_type(media_type_db: str | None, file_path: Path) -> str:
    """Determine the target media-type folder."""
    if media_type_db and media_type_db in MEDIA_TYPES:
        return media_type_db
    return detect_media_type_from_path(file_path)


def reorganize_media() -> int:
    """Reorganize media files into human-readable folders. Returns count moved."""
    conn = db.get_connection()
    moved = 0
    skipped = 0
    failed = 0
    path_updates: list[tuple[str, int, int]] = []

    rows = conn.execute(
        """
        SELECT chat_id, message_id, date_unix, file_path, media_type, sender_name
        FROM messages
        WHERE file_path IS NOT NULL
        """
    ).fetchall()

    for chat_id, message_id, date_unix, file_path, media_type, sender_name in rows:
        src = _resolve_source(file_path, chat_id, message_id)
        if src is None:
            logger.warning("[MIGRATE] Source not found for chat=%s msg=%s, skipping", chat_id, message_id)
            failed += 1
            continue

        already_new = _is_new_layout(src, settings.media_dir)
        has_sender = _has_sender_in_filename(src)

        if already_new and has_sender:
            if file_path != str(src):
                path_updates.append((str(src), chat_id, message_id))
            skipped += 1
            continue

        # If in new layout but missing sender name, re-migrate
        chat_name = db.get_chat_name(chat_id)
        chat_folder = get_chat_folder(chat_id, chat_name)
        message_date = datetime.fromtimestamp(date_unix)
        ext = "".join(src.suffixes) if src.suffixes else ""
        target_type = _infer_media_type(media_type, src)
        display_sender = sender_name or "Unknown User"
        dest = get_storage_path(
            settings.media_dir, message_id, message_date, target_type, ext,
            chat_folder=chat_folder, sender_name=display_sender,
        )

        logger.info("[MIGRATE] Moving:\n%s\n↓\n%s", src, dest)
        try:
            final = move_existing_media(src, dest)
            moved += 1
            logger.info("[MIGRATE] Database updated")
        except Exception:  # noqa: BLE001
            logger.exception("[MIGRATE] Failed to move %s", src)
            failed += 1
            continue

        if file_path != str(final):
            path_updates.append((str(final), chat_id, message_id))

    # Scan for stale old-layout files in subdirectories (no chat folder)
    _OLD_LAYOUT_MSG_RE = re.compile(r"_message_(\d+)")
    for media_type_dir in settings.media_dir.rglob("*"):
        if not media_type_dir.is_dir() or media_type_dir.name not in MEDIA_TYPES:
            continue
        # Check if parent is a chat folder (contains '[') — if so, already migrated
        if "[" in media_type_dir.parent.name:
            continue
        # Check if this is under a date layout (YYYY/<Month>/DD/<media_type>)
        try:
            rel = media_type_dir.relative_to(settings.media_dir)
        except ValueError:
            continue
        parts = rel.parts
        # Old layout: YYYY/<Month>/DD/<media_type> = 4 parts
        if len(parts) != 4:
            continue
        if not (len(parts[0]) == 4 and parts[0].isdigit() and "(" in parts[1]):
            continue

        for file_path in media_type_dir.iterdir():
            if not file_path.is_file():
                continue
            msg_match = _OLD_LAYOUT_MSG_RE.search(file_path.name)
            if not msg_match:
                continue
            message_id = int(msg_match.group(1))
            # Try to find this message in the DB
            row = conn.execute(
                "SELECT chat_id, date_unix, media_type, sender_name FROM messages WHERE message_id = ?",
                (message_id,),
            ).fetchone()
            if row is None:
                date_unix = int(file_path.stat().st_mtime)
                target_type = detect_media_type_from_path(file_path)
                chat_name = "Unknown User"
                chat_id_db = 0
                display_sender = "Unknown User"
            else:
                chat_id_db, date_unix, target_type_db, sender_name_db = row
                target_type = _infer_media_type(target_type_db, file_path)
                chat_name = db.get_chat_name(chat_id_db)
                display_sender = sender_name_db or "Unknown User"

            chat_folder = get_chat_folder(chat_id_db, chat_name)
            message_date = datetime.fromtimestamp(date_unix)
            ext = "".join(file_path.suffixes) if file_path.suffixes else ""
            dest = get_storage_path(
                settings.media_dir, message_id, message_date, target_type, ext,
                chat_folder=chat_folder, sender_name=display_sender,
            )
            logger.info("[MIGRATE] Moving:\n%s\n↓\n%s", file_path, dest)
            try:
                final = move_existing_media(file_path, dest)
                moved += 1
            except Exception:  # noqa: BLE001
                logger.exception("[MIGRATE] Failed to move %s", file_path)
                failed += 1
                continue

            if row and str(final) != file_path:
                path_updates.append((str(final), chat_id_db, message_id))

    # Scan for orphan flat files in the media root
    for path in settings.media_dir.iterdir():
        if not path.is_file():
            continue
        match = _FLAT_NAME.match(path.name)
        if not match:
            continue

        chat_id = int(match.group(1))
        message_id = int(match.group(2))
        row = conn.execute(
            "SELECT date_unix, media_type, sender_name FROM messages WHERE chat_id = ? AND message_id = ?",
            (chat_id, message_id),
        ).fetchone()
        if row is None:
            date_unix = int(path.stat().st_mtime)
            target_type = detect_media_type_from_path(path)
            display_sender = "Unknown User"
        else:
            date_unix, target_type, sender_name_db = row[0], row[1] or "other", row[2]
            target_type = _infer_media_type(target_type, path)
            display_sender = sender_name_db or "Unknown User"

        chat_name = db.get_chat_name(chat_id)
        chat_folder = get_chat_folder(chat_id, chat_name)
        message_date = datetime.fromtimestamp(date_unix)
        ext = "".join(path.suffixes) if path.suffixes else ""
        dest = get_storage_path(
            settings.media_dir, message_id, message_date, target_type, ext,
            chat_folder=chat_folder, sender_name=display_sender,
        )

        logger.info("[MIGRATE] Moving:\n%s\n↓\n%s", path, dest)
        try:
            final = move_existing_media(path, dest)
            moved += 1
            logger.info("[MIGRATE] Database updated")
        except Exception:  # noqa: BLE001
            logger.exception("[MIGRATE] Failed to move %s", path)
            failed += 1
            continue

        if row:
            path_updates.append((str(final), chat_id, message_id))

    for i, (new_path, chat_id, message_id) in enumerate(path_updates, 1):
        db.update_message_file_path(chat_id, message_id, new_path)
        if i % 100 == 0:
            db.commit()

    db.commit()
    logger.info(
        "[MIGRATE] Done — moved: %s, skipped (already organized): %s, failed: %s",
        moved,
        skipped,
        failed,
    )
    return moved
