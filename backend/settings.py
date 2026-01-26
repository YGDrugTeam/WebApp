from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


_BACKEND_DIR = Path(__file__).resolve().parent

# Load secrets from backend/.env first, then repo-root .env (optional).
load_dotenv(_BACKEND_DIR / ".env", override=False)
load_dotenv(_BACKEND_DIR.parent / ".env", override=False)


def _env_str(name: str, default: str | None = None) -> str:
    raw = os.getenv(name)
    if raw is None:
        return default or ""
    return str(raw).strip()


DB_PATH: str = _env_str("DB_PATH", default="mediclens.db")

AZURE_VISION_KEY: str = _env_str("AZURE_VISION_KEY")
AZURE_VISION_ENDPOINT: str = _env_str("AZURE_VISION_ENDPOINT")

AZURE_SPEECH_KEY: str = _env_str("AZURE_SPEECH_KEY")
AZURE_SPEECH_REGION: str = _env_str("AZURE_SPEECH_REGION", default="koreacentral")
