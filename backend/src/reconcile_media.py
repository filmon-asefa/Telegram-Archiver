"""Reconcile ``messages.file_path`` against media files already on disk.

Media may have been downloaded in an earlier run whose DB links were
lost (reorganized folders, interrupted updates, stale paths). This module
walks the media directory and re-links ``file_path`` for every message
whose file exists on disk but is not (or no longer) recorded in the DB.

Layout expected::

    media/YYYY/<Month Name (MM)>/DD/<Chat Name> [<chat_id>]/<media_type>/
        HH-MM-SS_<Sender Name>_message_<id>.ext

Invoke via: ``python -m src.main --scan-media``
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from . import db
from .config import settings
from .utils.media_storage import MEDIA_TYPES

logger = logging.getLogger(__name__)

_CHAT_ID_RE = re.compile(r"\[(-?\d+)\]\s*$")
_SELF_FOLDER_RE = re.compile(r"\[self\]\s*$", re.IGNORECASE)
_MSG_ID_RE = re.compile(r"_message_(\d+)(?: \(\d+\))?(?:\.[A-Za-z0-9]+)?$")

# chat_id used for the "Saved Messages" [self] folder
_SELF_CHAT_ID = 777000


def _parse_file(media_dir: Path, file_path: Path):
    """Extract (chat_id, message_id, media_type) from a media file path.

    Returns ``None`` for files that don't match the expected layout or
    don't carry enough information to identify a message.
    """
    try:
        rel = file_path.relative_to(media_dir)
    except ValueError:
        return None
    parts = rel.parts
    if len(parts) < 6:
        return None

    chat_folder = parts[-3]
    media_type = parts[-2]
    if media_type not in MEDIA_TYPES:
        return None

    match = _CHAT_ID_RE.search(chat_folder)
    if match:
        chat_id = int(match.group(1))
    elif _SELF_FOLDER_RE.search(chat_folder):
        chat_id = _SELF_CHAT_ID
    else:
        return None

    match = _MSG_ID_RE.search(file_path.name)
    if not match:
        return None
    return chat_id, int(match.group(1)), media_type


def reconcile_media(dry_run: bool = False) -> dict:
    """Link ``file_path`` for messages whose media already exists on disk.

    Also clears ``file_path`` for messages whose recorded file no longer
    exists on disk, so those files can be re-downloaded (``--media-only``).

    Returns a summary dict with counts: scanned, linked, fixed, cleared,
    skipped, type_mismatch.
    """
    conn = db.get_connection()
    media_dir = settings.media_dir
    summary = {"scanned": 0, "linked": 0, "fixed": 0, "cleared": 0, "skipped": 0, "type_mismatch": 0}

    rows = conn.execute(
        "SELECT chat_id, message_id, media_type, file_path "
        "FROM messages WHERE media_type IS NOT NULL"
    ).fetchall()
    by_key = {(r[0], r[1]): (r[2], r[3]) for r in rows}

    # Unlink paths that point at files missing on disk.
    clears: list[tuple[int, int]] = []
    for (chat_id, message_id), (_type, db_path) in by_key.items():
        if db_path and not Path(db_path).exists():
            summary["cleared"] += 1
            clears.append((chat_id, message_id))
            logger.info("[RECONCILE] chat=%s msg=%s: clearing stale path %s", chat_id, message_id, db_path)

    updates: list[tuple[int, int, str]] = []
    for file_path in media_dir.rglob("*"):
        if not file_path.is_file():
            continue
        parsed = _parse_file(media_dir, file_path)
        if parsed is None:
            continue
        chat_id, message_id, folder_type = parsed
        summary["scanned"] += 1

        row = by_key.get((chat_id, message_id))
        if row is None:
            summary["skipped"] += 1
            continue

        db_type, db_path = row
        if db_type != folder_type:
            summary["type_mismatch"] += 1
            continue

        if db_path and Path(db_path).exists():
            summary["skipped"] += 1
            continue

        stored = str(file_path)
        if db_path == stored:
            summary["skipped"] += 1
            continue

        if db_path is None:
            summary["linked"] += 1
        else:
            summary["fixed"] += 1
            logger.info("[RECONCILE] chat=%s msg=%s: stale %s → %s", chat_id, message_id, db_path, stored)
        updates.append((chat_id, message_id, stored))

    if not dry_run:
        for i, (chat_id, message_id, stored) in enumerate(updates, 1):
            db.update_message_file_path(chat_id, message_id, stored)
            if i % 500 == 0:
                db.commit()
        for chat_id, message_id in clears:
            db.update_message_file_path(chat_id, message_id, None)
        db.commit()

    logger.info(
        "[RECONCILE] Done — %s (dry_run=%s)",
        summary,
        dry_run,
    )
    return summary
