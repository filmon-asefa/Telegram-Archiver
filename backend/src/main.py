"""Entry point.

    python -m src.main                        # backfill history, then listen live
    python -m src.main --backfill             # backfill only, then exit
    python -m src.main --backfill-all         # force full re-backfill from message 0
    python -m src.main --backfill-all --no-media  # fast text-only full backfill
    python -m src.main --backfill-chat 12345  # backfill a single chat
    python -m src.main --media-only           # download media for messages missing it
    python -m src.main --listen               # live listener only
    python -m src.main --reorganize-media     # migrate media into human-readable folders
    python -m src.main --resolve-forwards      # resolve forward source names for existing messages
    python -m src.main --resolve-topics        # fetch real topic names/metadata for forum chats
"""
from __future__ import annotations

import argparse
import asyncio
import logging

from . import db
from .backfill import run_backfill, run_media_download
from .forward_fix import run_resolve
from .listener import run_listener
from .reconcile_media import reconcile_media
from .reorganize_media import reorganize_media
from .resolve_topics import run_resolve_topics

logger = logging.getLogger(__name__)


async def run(do_backfill: bool, do_listen: bool, force: bool = False,
              chat_id: int | None = None, skip_media: bool = False,
              media_only: bool = False, resolve_forwards: bool = False,
              resolve_topics: bool = False) -> None:
    if resolve_forwards:
        logger.info("=== Resolving forward authors ===")
        await run_resolve()
        return
    if resolve_topics:
        logger.info("=== Resolving forum topic metadata ===")
        await run_resolve_topics(chat_id=chat_id)
        return
    if media_only:
        logger.info("=== Downloading missing media ===")
        await run_media_download(chat_id=chat_id)
    elif do_backfill:
        logger.info("=== Starting backfill ===")
        await run_backfill(force=force, chat_id=chat_id, skip_media=skip_media)
    if do_listen:
        logger.info("=== Starting live listener ===")
        await run_listener()


def main() -> None:
    parser = argparse.ArgumentParser(description="Telegram to SQLite archiver")
    parser.add_argument("--backfill", action="store_true", help="Run backfill only")
    parser.add_argument("--backfill-all", action="store_true", help="Force full re-backfill from message 0")
    parser.add_argument("--backfill-chat", type=int, default=None, help="Backfill a single chat by ID")
    parser.add_argument("--no-media", action="store_true", help="Skip media downloads (text-only)")
    parser.add_argument("--media-only", action="store_true", help="Only download media for messages missing it")
    parser.add_argument("--listen", action="store_true", help="Run live listener only")
    parser.add_argument(
        "--reorganize-media",
        action="store_true",
        help="Migrate media into YYYY/<Month>/DD/<Chat Name> [<id>]/<type>/HH-MM-SS_<Sender>_message_<id>.ext, then exit",
    )
    parser.add_argument(
        "--scan-media",
        action="store_true",
        help="Reconcile messages.file_path against media files already on disk, then exit",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --scan-media: report what would be linked without writing",
    )
    parser.add_argument("--resolve-forwards", action="store_true", help="Resolve forward source names for existing messages")
    parser.add_argument("--resolve-topics", action="store_true", help="Fetch real topic names/metadata for forum chats")
    args = parser.parse_args()

    if args.scan_media:
        summary = reconcile_media(dry_run=args.dry_run)
        logger.info("Media reconciliation result: %s", summary)
        db.close()
        return

    if args.reorganize_media:
        count = reorganize_media()
        logger.info("Reorganized %s media file(s).", count)
        db.close()
        return

    if args.resolve_forwards:
        asyncio.run(run(do_backfill=False, do_listen=False, resolve_forwards=True))
        db.close()
        return

    if args.resolve_topics:
        asyncio.run(run(do_backfill=False, do_listen=False, resolve_topics=True, chat_id=args.backfill_chat))
        db.close()
        return

    do_backfill = args.backfill or args.backfill_all or args.backfill_chat is not None or args.media_only or (not args.listen)
    do_listen = args.listen or (not args.backfill and not args.backfill_all and args.backfill_chat is None and not args.media_only)

    if args.listen and not args.backfill and not args.backfill_all and args.backfill_chat is None and not args.media_only:
        do_backfill = False

    try:
        asyncio.run(run(
            do_backfill, do_listen,
            force=args.backfill_all,
            chat_id=args.backfill_chat,
            skip_media=args.no_media,
            media_only=args.media_only,
        ))
    except KeyboardInterrupt:
        logger.info("Stopped by user.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
