# Telegram Archiver

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://python.org)
[![Node.js 18+](https://img.shields.io/badge/node-18+-green.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#)

Full local backup of all Telegram chats with a real-time web UI (Telegram Desktop style). Backs up text, media, edits, and deletions into SQLite.

> **Security:** Never share your `.env` file or `.session` files — they contain your Telegram credentials. Never commit them to version control.

## Features

- **Full history backup** — all messages, media, edits, deletions
- **Live capture** — new messages saved in real-time
- **Telegram-style UI** — dark theme, infinite scroll, media gallery
- **Edit & delete tracking** — see message history and deleted content
- **Full-text search** across all chats
- **Media gallery** with type filters (photos, videos, voice, documents)
- **Cross-platform** — macOS, Linux, Windows, Docker

## Project Structure

```
telegram-archiver/
├── backend/               # Python (Telethon + SQLite)
│   ├── src/               # Source code
│   │   ├── main.py        # CLI entry point
│   │   ├── config.py      # Environment config loader
│   │   ├── db.py          # SQLite layer (WAL mode)
│   │   ├── listener.py    # Live message capture
│   │   ├── backfill.py    # Bulk history export + media download
│   │   ├── telegram_client.py
│   │   └── utils/
│   ├── requirements.txt
│   └── pyproject.toml
│
├── frontend/              # Next.js 16 web UI
│   ├── src/
│   │   ├── app/           # Pages + API routes
│   │   ├── components/    # React components
│   │   └── lib/           # DB reader + utilities
│   └── package.json
│
├── data/                  # Shared data (gitignored)
├── Dockerfile
├── docker-compose.yml
├── start.sh               # Service manager (macOS/Linux)
├── .env.example           # Config template
└── README.md
```

## Prerequisites

You need:
- **Python 3.9+** — check with `python3 --version` (or `python --version` on Windows)
- **Node.js 18+** — check with `node --version`
- **Telegram API credentials** — from https://my.telegram.org

> **Note:** On macOS and most Linux systems, Python is invoked as `python3`. On Windows it may be `python` or `py`. Use whichever works on your system.

## Quick Start

### 1. Get Telegram API Credentials

1. Go to https://my.telegram.org → API development tools
2. Create an app, copy the **App api_id** and **App api_hash**

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `TG_API_ID` — your API ID (number)
- `TG_API_HASH` — your API hash (string)
- `TG_PHONE` — your phone in international format (e.g. `+15551234567`)

### 3. Install Dependencies

```bash
# Backend
pip3 install -r backend/requirements.txt

# Frontend
cd frontend && npm install && cd ..
```

### 4. Start Everything

**All commands must be run from the project root directory** (the folder containing `backend/` and `frontend/`).

#### macOS / Linux

```bash
./start.sh start
```

#### Windows (Git Bash / WSL)

```bash
bash start.sh start
```

#### Windows (Command Prompt / PowerShell) — manual start

```cmd
cd backend
set PYTHONPATH=.
start /B python -m src.main --listen
cd ..\frontend
start /B npx next dev --webpack --port 3000
```

This starts:
- **Listener** — live message capture
- **Media Downloader** — downloads photos, videos, documents, voice notes
- **Web UI** — http://localhost:3000

### 5. First-Time Setup

On first launch, you'll be prompted for a Telegram login code. Enter it when asked. The backfill runs automatically to download your full history.

### Docker

```bash
docker compose up
```

## Usage

### Commands (macOS / Linux)

```bash
./start.sh start      # Start all services
./start.sh stop       # Stop all services
./start.sh restart    # Restart all services
./start.sh status     # Check service status
./start.sh tunnel     # Create public URL via localtunnel
```

### Running Backend Manually

**Important:** Always run from the **project root** directory (where `backend/` and `frontend/` live).

On macOS / Linux:

```bash
# Full history backfill (all chats)
PYTHONPATH=backend python3 -m src.main --backfill-all --no-media

# Backfill a single chat
PYTHONPATH=backend python3 -m src.main --backfill-chat 123456789

# Download only missing media
PYTHONPATH=backend python3 -m src.main --media-only

# Live listener only
PYTHONPATH=backend python3 -m src.main --listen

# Reorganize media files into readable folders
PYTHONPATH=backend python3 -m src.main --reorganize-media
```

On Windows (Command Prompt):

```cmd
cd backend
set PYTHONPATH=.
python -m src.main --listen
python -m src.main --backfill-all --no-media
python -m src.main --media-only
```

On Windows (PowerShell):

```powershell
cd backend
$env:PYTHONPATH="."
python -m src.main --listen
python -m src.main --backfill-all --no-media
```

### Running Frontend Manually

```bash
cd frontend
npm run dev
```

### Troubleshooting: "No module named 'src'"

This error means you ran the command from the **wrong directory**. Make sure:

1. You are in the **project root** (the folder with `backend/` and `frontend/` inside it)
2. `PYTHONPATH=backend` is set (macOS/Linux) or `set PYTHONPATH=.` inside `backend/` (Windows)
3. You run `python3 -m src.main` (not `python -m src.main` from inside `backend/`)

```bash
# WRONG — from inside backend/:
cd backend
PYTHONPATH=backend python3 -m src.main --listen   # ERROR

# CORRECT — from project root:
cd telegram-archiver
PYTHONPATH=backend python3 -m src.main --listen    # OK

# ALSO CORRECT — from inside backend/ with PYTHONPATH=.:
cd backend
PYTHONPATH=. python3 -m src.main --listen           # OK
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TG_API_ID` | Yes | — | Telegram API ID from my.telegram.org |
| `TG_API_HASH` | Yes | — | Telegram API hash |
| `TG_PHONE` | Yes | — | Phone number in international format |
| `DB_PATH` | No | `./data/telegram_archive.db` | SQLite database path |
| `MEDIA_DIR` | No | `./data/media` | Media storage directory |
| `DOWNLOAD_MEDIA` | No | `true` | Download media files |
| `ARCHIVER_DB_PATH` | No | auto | Frontend DB override |
| `ARCHIVER_MEDIA_ROOT` | No | auto | Frontend media root override |

## Media Layout

```
data/media/
└── YYYY/
    └── Month Name (MM)/
        └── DD/
            └── Chat Name [chat_id]/
                ├── photos/
                ├── videos/
                ├── voice/
                ├── documents/
                └── audio/
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `chats` | Chat metadata (name, type, last synced ID) |
| `messages` | All messages (chat_id + message_id PK) |
| `message_edits` | Edit history (old text → new text) |
| `message_deleted` | Deleted message snapshots |
| `message_snapshot` | Pre-edit/deletion message states |

## Tech Stack

- **Backend**: Python 3.9+, Telethon, SQLite (WAL mode)
- **Frontend**: Next.js 16, React 19, Tailwind CSS v4, TypeScript
- **DB Reader**: Node.js `node:sqlite` (built-in, no native modules)

## Platform Support

| Platform | Service Manager | Python Command | Start Script |
|----------|----------------|----------------|--------------|
| macOS | launchd | `python3` | `./start.sh start` |
| Linux | systemd | `python3` | `./start.sh start` |
| Windows | Direct | `python` or `py` | `bash start.sh start` (Git Bash) |
| Docker | Docker Compose | built-in | `docker compose up` |

## Troubleshooting

### "No module named 'src'" or "ModuleNotFoundError"

You're running from the wrong directory. Always run from the **project root**:
```bash
cd telegram-archiver   # must contain backend/ and frontend/
PYTHONPATH=backend python3 -m src.main --listen
```

### "database is locked" errors
The listener and media downloader run as separate processes. Both use WAL mode with retry logic. If errors persist:
```bash
./start.sh restart
```

### Media not downloading
```bash
tail -f logs/media.log
```

### UI shows stale data
The UI reads directly from SQLite. Refresh the browser or restart:
```bash
./start.sh restart
```

### Python command not found
- **macOS:** Try `python3` instead of `python`
- **Windows:** Try `py` or install Python from https://python.org and check "Add to PATH"
- **Linux:** `sudo apt install python3` (Debian/Ubuntu) or `sudo dnf install python3` (Fedora)

### Node.js / npm not found
Install from https://nodejs.org (LTS version recommended).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## License

[MIT](LICENSE) — see the [LICENSE](LICENSE) file for details.
