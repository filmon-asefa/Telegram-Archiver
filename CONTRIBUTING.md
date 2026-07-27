# Contributing to Telegram Archiver

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

### Prerequisites
- Python 3.9+
- Node.js 18+
- A Telegram API ID and hash from https://my.telegram.org

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend
```bash
cd frontend
npm install
```

### Configuration
```bash
cp .env.example .env
# Edit .env with your Telegram API credentials
```

## Running Locally

```bash
./start.sh start    # Starts all services
./start.sh status   # Check what's running
./start.sh stop     # Stop everything
```

Or run individual components:
```bash
# Backend only
cd backend && PYTHONPATH=. python -m src.main --listen

# Frontend only
cd frontend && npm run dev
```

## Project Structure

```
telegram-archiver/
├── backend/               # Python (Telethon + SQLite)
│   ├── src/               # Source code
│   └── requirements.txt
├── frontend/              # Next.js 16 web UI
│   ├── src/
│   └── package.json
├── data/                  # SQLite DB + media (gitignored)
├── .env                   # Your config (gitignored)
└── start.sh               # Service manager
```

## Code Style

### Python
- Follow PEP 8
- Use type hints
- Docstrings for public functions

### TypeScript/React
- Use TypeScript strict mode
- Follow existing patterns in the codebase
- Tailwind CSS for styling

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test locally with `./start.sh start`
5. Commit with a clear message
6. Open a pull request

## Reporting Issues

- Use GitHub Issues
- Include your OS, Python version, and Node version
- Include relevant log output (from `logs/`)

## Security

**Never commit your `.env` file or session files (`.session`).** These contain your Telegram credentials.

If you find a security vulnerability, please report it privately via email rather than opening a public issue.
