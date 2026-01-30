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
    value = str(raw).strip()
    # Allow values copied with surrounding quotes (common in .env editing)
    if len(value) >= 2 and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'")):
        value = value[1:-1].strip()
    return value


DB_PATH: str = _env_str("DB_PATH", default="mediclens.db")

AZURE_VISION_KEY: str = _env_str("AZURE_VISION_KEY")
AZURE_VISION_ENDPOINT: str = _env_str("AZURE_VISION_ENDPOINT")

AZURE_SPEECH_KEY: str = _env_str("AZURE_SPEECH_KEY") or _env_str("SPEECH_KEY")
AZURE_SPEECH_ENDPOINT: str = _env_str("AZURE_SPEECH_ENDPOINT") or _env_str("SPEECH_ENDPOINT")
AZURE_SPEECH_REGION: str = _env_str("AZURE_SPEECH_REGION", default="") or _env_str("SPEECH_REGION", default="koreacentral")

# ODCloud(OpenAPI) - pharmacy finder, DUR, etc.
ODCLOUD_API_BASE: str = _env_str("ODCLOUD_API_BASE", default="https://api.odcloud.kr/api")
ODCLOUD_SERVICE_KEY: str = _env_str("ODCLOUD_SERVICE_KEY")
ODCLOUD_AUTHORIZATION: str = _env_str("ODCLOUD_AUTHORIZATION")

# Pharmacy dataset (api.odcloud.kr): set the dataset path you want to query.
# Example: /{api_id}/v1/uddi:{uuid}
PHARMACY_SERVICE_PATH: str = _env_str("PHARMACY_SERVICE_PATH")

# Optional local pharmacy dataset (CSV). If set and the file exists, the Flask
# pharmacy endpoints will use it instead of ODCloud.
# Example: backend/data/pharmacies_seoul_utf8.csv
PHARMACY_LOCAL_CSV: str = _env_str("PHARMACY_LOCAL_CSV")

# DUR dataset (api.odcloud.kr) for 병용금기
# Example: /15089525/v1/uddi:3f2efdac-942b-494e-919f-8bdc583f65ea
DUR_SERVICE_PATH: str = _env_str("DUR_SERVICE_PATH")
