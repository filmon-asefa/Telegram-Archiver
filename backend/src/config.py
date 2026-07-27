"""Centralized configuration, loaded once from .env.

Every other module imports `settings` from here instead of reading
os.environ directly. Fails fast and loudly if required values are missing,
so you find out at startup, not three hours into a backfill.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root (one level up from backend/)
_project_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(_project_root / ".env")


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value or not value.strip():
        raise ConfigError(
            f"Missing required environment variable: {name}. "
            f"Copy .env.example to .env and fill it in."
        )
    return value.strip()


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    api_id: int
    api_hash: str
    phone: str
    session_name: str
    db_path: Path
    media_dir: Path
    download_media: bool
    log_level: str


def load_settings() -> Settings:
    try:
        api_id = int(_require("TG_API_ID"))
    except ValueError as exc:
        raise ConfigError("TG_API_ID must be an integer") from exc

    db_path = Path(os.getenv("DB_PATH", "./data/telegram_archive.db")).expanduser()
    media_dir = Path(os.getenv("MEDIA_DIR", "./data/media")).expanduser()

    db_path.parent.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)

    return Settings(
        api_id=api_id,
        api_hash=_require("TG_API_HASH"),
        phone=_require("TG_PHONE"),
        session_name=os.getenv("SESSION_NAME", "telegram_archive"),
        db_path=db_path,
        media_dir=media_dir,
        download_media=_bool("DOWNLOAD_MEDIA", True),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
    )


settings = load_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
