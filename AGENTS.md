# Telegram Archiver — AGENTS.md

## Project Overview
Full local backup of all Telegram chats with real-time message/edit/delete capture, media download, and a Telegram Desktop-style Next.js web UI with SQLite.

## Commands (run from project root)

### Backend
```sh
# Backfill + listen (default)
PYTHONPATH=backend python3 -m src.main

# Backfill only
PYTHONPATH=backend python3 -m src.main --backfill
PYTHONPATH=backend python3 -m src.main --backfill-all
PYTHONPATH=backend python3 -m src.main --backfill-all --no-media
PYTHONPATH=backend python3 -m src.main --backfill-chat 12345

# Live listener only
PYTHONPATH=backend python3 -m src.main --listen

# Media only
PYTHONPATH=backend python3 -m src.main --media-only

# Reorganize media folders
PYTHONPATH=backend python3 -m src.main --reorganize-media

# Reconcile messages.file_path against media already on disk
PYTHONPATH=backend python3 -m src.main --scan-media
PYTHONPATH=backend python3 -m src.main --scan-media --dry-run

# Resolve forward source names for existing messages
PYTHONPATH=backend python3 -m src.main --resolve-forwards
```

### Frontend
```sh
cd frontend
npm run dev
```

### Type check
```sh
cd frontend && npx tsc --noEmit
```

## Key Architecture

### Database (backend/src/db.py)
- Single shared WAL-mode SQLite connection
- `get_connection()` — returns shared connection, lazy-init
- Connection stored in global `_connection`, committed via `db.commit()`
- Schema auto-created + auto-migrated (ALTER TABLE ADD COLUMN) on first connect
- Tables: `chats`, `messages`, `message_edits`, `message_deleted`, `message_snapshot`

### Message Lifecycle

**New message → DB:**
1. `events.NewMessage(outgoing=True, incoming=True)` fires
2. `handler()` extracts: sender, media_type, forward_info (async via `extract_forward_info`)
3. `db.insert_message()` inserts into `messages`
4. If media: `asyncio.create_task(_download_and_attach())` downloads async

**Edit:** `events.MessageEdited` → `save_message_snapshot()` → `record_edit()`

**Delete:** `events.MessageDeleted` → `save_message_snapshot()` → `record_deletion()` (marks `is_deleted=1`, does NOT delete row)

### Listener (backend/src/listener.py)
- `run_listener()` → `reconcile_media()` (links `file_path` for media already on disk) → `start_sse_server()` → `register_handlers(client)` → `_initial_backfill()` → listen forever
- Heartbeat every 5min, catch-up cycle every 30min
- Backfill: `client.iter_messages(dialog, min_id=last_synced, reverse=True)`
- `_with_db_retry(fn)` — retries DB writes up to 3x on lock errors

### Deleted Messages (new behavior)
- Messages stay in `messages` table with `is_deleted=1, deleted_at_unix`
- `message_deleted` table records the deletion event
- Frontend shows strikethrough original text + red DELETED banner
- ChatView: `prev.map(m => ...m, is_deleted:1)` instead of `filter()`

### Forwarded Messages
- `telegram_client.extract_forward_info(message, client)` — async, resolves `post_author` from entity cache when `fwd.post_author` is null
- Returns dict with `is_forward`, `fwd_from_chat_id`, `fwd_from_msg_id`, `fwd_from_date`, `fwd_from_author`
- Frontend: blue "Forwarded from {author}" badge with arrow icon

### Session & DC Notes
- Account migrated from DC2 → DC4; old session on DC2 connects but never receives events
- Multiple listener processes fighting over same `.session` file causes `Connection reset by peer`
- Fresh session on DC4 fixed live capture; use `telegram_archive.session` only
- `telegram_archive_fwd_fix.session` created by `--resolve-forwards`

## Frontend Structure

### Key Files
- `frontend/src/lib/db.ts` — server-side SQLite reader (node:sqlite), TypeScript `Message` interface
- `frontend/src/app/chat/[id]/ChatView.tsx` — chat page, message grouping, polling
- `frontend/src/components/MessageBubble.tsx` — single message bubble renderer
- `frontend/src/components/VoiceMessage.tsx` — Telegram Desktop-style voice player (waveform, seek, play/pause, duration, status row)
- `frontend/src/app/api/changes/route.ts` — polling endpoint for new/edited/deleted messages

### State Management
- `messages` stored newest-first (DESC from API), reversed for display
- `displayMessages = [...messages].reverse()` → oldest-first for rendering
- Polled `fresh` messages PREPENDED: `[...fresh, ...messagesRef.current]`
- `editCounts` tracked separately for "edited" badges
- Date separators use `getDayKey(unix)` → `date-YYYY-M-D` keys

### Message Interface
```typescript
interface Message {
  chat_id: number; message_id: number;
  sender_id: number | null; sender_name: string | null;
  is_outgoing: number; date_unix: number;
  text: string | null; media_type: string | null;
  file_path: string | null;
  is_forward: number; fwd_from_author: string | null;
  is_deleted: number; deleted_at_unix: number | null;
}
```

## Media Downloads
- `download_with_retry()` in `telegram_client.py` — 120s timeout, 3 retries, flood wait handling
- Uses `asyncio.wait_for()` and catches `FloodWaitError`
- Media stored in `data/media/YYYY/Month Name/DD/Chat Name [id]/type/HH-MM-SS_Sender_message_NNNN.ext`
- `reconcile_media()` in `reconcile_media.py` walks `data/media`, parses chat id + message id + type from folder/filename, and backfills `file_path` for messages whose media exists on disk but is unlinked or stale. Runs automatically at listener startup and via `--scan-media`. `--dry-run` reports without writing.
- `/media-files` route transcodes voice (Opus-in-Ogg) to AAC `.m4a` on demand via `afconvert` (Safari can't play Ogg/Opus), caching results in `data/media_cache/`.

## Known Issues
- `next.config.ts` TypeScript error about `allowedDevOrigins` — pre-existing, harmless
- `frontend/src/lib/db.ts` `node:sqlite` import error — pre-existing, runtime-only module
- Pre-existing type errors about `Record<string, unknown>` in deleted/edits routes
