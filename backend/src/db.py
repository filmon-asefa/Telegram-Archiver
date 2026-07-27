"""SQLite access layer.

One shared connection, WAL mode for safe concurrent reads while the
listener writes, and small helper functions so backfill.py and
listener.py never touch raw SQL directly.
"""
from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Optional

from .config import settings

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS chats (
    chat_id INTEGER PRIMARY KEY,
    chat_name TEXT,
    chat_type TEXT,               -- 'user', 'group', 'channel'
    last_synced_message_id INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    sender_id INTEGER,
    sender_name TEXT,
    is_outgoing INTEGER NOT NULL DEFAULT 0,
    date_unix INTEGER NOT NULL,
    text TEXT,
    media_type TEXT,              -- 'photos' | 'videos' | 'voice' | 'documents' | 'audio' | 'stickers' | 'animations' | 'contacts' | 'locations' | 'polls' | 'other' | NULL
    file_path TEXT,
    PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_date
    ON messages (chat_id, date_unix);

CREATE INDEX IF NOT EXISTS idx_messages_sender
    ON messages (sender_id);

CREATE TABLE IF NOT EXISTS message_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    old_text TEXT,
    new_text TEXT,
    edited_at_unix INTEGER NOT NULL,
    FOREIGN KEY (chat_id, message_id) REFERENCES messages(chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_edits_chat_msg
    ON message_edits (chat_id, message_id);

CREATE TABLE IF NOT EXISTS message_deleted (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    deleted_at_unix INTEGER NOT NULL,
    old_text TEXT,
    old_sender_name TEXT,
    old_date_unix INTEGER,
    old_media_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_deleted_chat_msg
    ON message_deleted (chat_id, message_id);

CREATE TABLE IF NOT EXISTS message_snapshot (
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    sender_id INTEGER,
    sender_name TEXT,
    is_outgoing INTEGER NOT NULL DEFAULT 0,
    date_unix INTEGER NOT NULL,
    text TEXT,
    media_type TEXT,
    file_path TEXT,
    snapshot_at_unix INTEGER NOT NULL,
    PRIMARY KEY (chat_id, message_id)
);
"""


_connection: Optional[sqlite3.Connection] = None


def get_connection() -> sqlite3.Connection:
    """Return the shared connection, creating and initializing it on first use."""
    global _connection
    if _connection is None:
        _connection = _connect(settings.db_path)
    return _connection


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=120, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=120000;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.executescript(SCHEMA)
    conn.commit()
    logger.info("Database ready at %s", db_path)
    return conn


def upsert_chat(chat_id: int, chat_name: str, chat_type: str) -> None:
    conn = get_connection()
    conn.execute(
        """
        INSERT INTO chats (chat_id, chat_name, chat_type)
        VALUES (?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
            chat_name = excluded.chat_name,
            chat_type = excluded.chat_type
        """,
        (chat_id, chat_name, chat_type),
    )


def get_last_synced_message_id(chat_id: int) -> int:
    conn = get_connection()
    row = conn.execute(
        "SELECT last_synced_message_id FROM chats WHERE chat_id = ?", (chat_id,)
    ).fetchone()
    return row[0] if row else 0


def set_last_synced_message_id(chat_id: int, message_id: int) -> None:
    conn = get_connection()
    conn.execute(
        "UPDATE chats SET last_synced_message_id = ? WHERE chat_id = ? "
        "AND last_synced_message_id < ?",
        (message_id, chat_id, message_id),
    )


def insert_message(
    chat_id: int,
    message_id: int,
    sender_id: Optional[int],
    sender_name: Optional[str],
    is_outgoing: bool,
    date_unix: int,
    text: Optional[str],
    media_type: Optional[str],
    file_path: Optional[str],
) -> None:
    conn = get_connection()
    conn.execute(
        """
        INSERT OR IGNORE INTO messages
            (chat_id, message_id, sender_id, sender_name, is_outgoing,
             date_unix, text, media_type, file_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            chat_id,
            message_id,
            sender_id,
            sender_name,
            int(is_outgoing),
            date_unix,
            text,
            media_type,
            file_path,
        ),
    )


def update_message_file_path(chat_id: int, message_id: int, file_path: str) -> None:
    """Used when media downloads finish after the row was already inserted."""
    conn = get_connection()
    conn.execute(
        "UPDATE messages SET file_path = ? WHERE chat_id = ? AND message_id = ?",
        (file_path, chat_id, message_id),
    )


def get_chat_name(chat_id: int) -> str:
    """Return the stored chat name, or 'Unknown User' if not found."""
    conn = get_connection()
    row = conn.execute(
        "SELECT chat_name FROM chats WHERE chat_id = ?", (chat_id,)
    ).fetchone()
    return row[0] if row and row[0] else "Unknown User"


def get_messages_missing_media(chat_id: int) -> list[tuple]:
    """Return (message_id, media_type, sender_name) for messages with media but no file_path."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT message_id, media_type, sender_name FROM messages "
        "WHERE chat_id = ? AND media_type IS NOT NULL AND file_path IS NULL",
        (chat_id,),
    ).fetchall()
    return rows


def commit() -> None:
    import time as _time
    for _attempt in range(10):
        try:
            get_connection().commit()
            return
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e) and _attempt < 9:
                _time.sleep(0.5 * (_attempt + 1))
            else:
                raise


def save_message_snapshot(chat_id: int, message_id: int) -> None:
    """Save the current state of a message before it gets edited/deleted."""
    conn = get_connection()
    row = conn.execute(
        "SELECT chat_id, message_id, sender_id, sender_name, is_outgoing, date_unix, text, media_type, file_path "
        "FROM messages WHERE chat_id = ? AND message_id = ?",
        (chat_id, message_id),
    ).fetchone()
    if row is None:
        return
    import time
    conn.execute(
        """
        INSERT OR REPLACE INTO message_snapshot
            (chat_id, message_id, sender_id, sender_name, is_outgoing,
             date_unix, text, media_type, file_path, snapshot_at_unix)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (*row, int(time.time())),
    )


def record_edit(chat_id: int, message_id: int, old_text: str | None, new_text: str | None) -> None:
    """Record that a message was edited."""
    import time
    conn = get_connection()
    conn.execute(
        "INSERT INTO message_edits (chat_id, message_id, old_text, new_text, edited_at_unix) "
        "VALUES (?, ?, ?, ?, ?)",
        (chat_id, message_id, old_text, new_text, int(time.time())),
    )


def record_deletion(chat_id: int, message_id: int) -> None:
    """Record that a message was deleted, saving its last known state."""
    import time
    conn = get_connection()
    now = int(time.time())
    row = conn.execute(
        "SELECT sender_name, date_unix, text, media_type FROM messages "
        "WHERE chat_id = ? AND message_id = ?",
        (chat_id, message_id),
    ).fetchone()
    if row:
        conn.execute(
            "INSERT INTO message_deleted (chat_id, message_id, deleted_at_unix, "
            "old_text, old_sender_name, old_date_unix, old_media_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (chat_id, message_id, now, row[2], row[0], row[1], row[3]),
        )
    else:
        conn.execute(
            "INSERT INTO message_deleted (chat_id, message_id, deleted_at_unix) "
            "VALUES (?, ?, ?)",
            (chat_id, message_id, now),
        )


def update_message_text(chat_id: int, message_id: int, text: str | None, sender_name: str | None = None) -> None:
    """Update message text and optionally sender_name after an edit event."""
    conn = get_connection()
    if sender_name is not None:
        conn.execute(
            "UPDATE messages SET text = ?, sender_name = ? WHERE chat_id = ? AND message_id = ?",
            (text, sender_name, chat_id, message_id),
        )
    else:
        conn.execute(
            "UPDATE messages SET text = ? WHERE chat_id = ? AND message_id = ?",
            (text, chat_id, message_id),
        )


def delete_message(chat_id: int, message_id: int) -> None:
    """Remove a message from the messages table after it's been deleted."""
    conn = get_connection()
    conn.execute(
        "DELETE FROM messages WHERE chat_id = ? AND message_id = ?",
        (chat_id, message_id),
    )


def get_edits(chat_id: int, message_id: int) -> list[dict]:
    """Return edit history for a message."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT old_text, new_text, edited_at_unix FROM message_edits "
        "WHERE chat_id = ? AND message_id = ? ORDER BY edited_at_unix",
        (chat_id, message_id),
    ).fetchall()
    return [{"old_text": r[0], "new_text": r[1], "edited_at_unix": r[2]} for r in rows]


def get_deleted_messages(chat_id: int, limit: int = 50) -> list[dict]:
    """Return deleted messages for a chat."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT message_id, deleted_at_unix, old_text, old_sender_name, old_date_unix, old_media_type "
        "FROM message_deleted WHERE chat_id = ? ORDER BY deleted_at_unix DESC LIMIT ?",
        (chat_id, limit),
    ).fetchall()
    return [
        {
            "message_id": r[0], "deleted_at_unix": r[1], "old_text": r[2],
            "old_sender_name": r[3], "old_date_unix": r[4], "old_media_type": r[5],
        }
        for r in rows
    ]


def get_changes_since(unix: int) -> dict:
    """Return all edits and deletions since a given timestamp, grouped by chat."""
    conn = get_connection()
    edits = conn.execute(
        "SELECT chat_id, message_id, old_text, new_text, edited_at_unix "
        "FROM message_edits WHERE edited_at_unix > ? ORDER BY edited_at_unix",
        (unix,),
    ).fetchall()
    deletions = conn.execute(
        "SELECT chat_id, message_id, deleted_at_unix, old_text, old_sender_name "
        "FROM message_deleted WHERE deleted_at_unix > ? ORDER BY deleted_at_unix",
        (unix,),
    ).fetchall()
    return {
        "edits": [
            {"chat_id": e[0], "message_id": e[1], "old_text": e[2], "new_text": e[3], "edited_at_unix": e[4]}
            for e in edits
        ],
        "deletions": [
            {"chat_id": d[0], "message_id": d[1], "deleted_at_unix": d[2], "old_text": d[3], "old_sender_name": d[4]}
            for d in deletions
        ],
    }


def close() -> None:
    global _connection
    if _connection is not None:
        _connection.commit()
        _connection.close()
        _connection = None
