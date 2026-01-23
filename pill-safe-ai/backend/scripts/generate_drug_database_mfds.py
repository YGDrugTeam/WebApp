"""Generate drug database JSON from MFDS (공공데이터포털/식약처) OpenAPI.

IMPORTANT
- I cannot obtain or "find" your API key.
- You must create a service key in the official portal and provide it via env or CLI.

This script is intentionally defensive about field names because MFDS endpoints may vary.
You can adjust MFDS_ENDPOINT if your project uses a different dataset.

Usage (PowerShell)
  # 1) Put your key into backend/.env (recommended)
  #    AZURE... vars are unrelated; this one is for MFDS
  #    MFDS_SERVICE_KEY=...
  #
  # 2) Run:
  C:/dev/pill-safe-ai/.venv/Scripts/python.exe backend/scripts/generate_drug_database_mfds.py \
    --count 300 \
    --out frontend/src/data/drugDatabase.json

If your endpoint differs
  - Use --endpoint to override.

Notes
- Requires outbound internet access.
- If the API returns XML, set --format xml (we'll parse minimal fields).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass


# Default endpoint (commonly used by MFDS datasets on data.go.kr)
MFDS_ENDPOINT_DEFAULT = os.getenv(
    "MFDS_ENDPOINT",
    "https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList",
)


def _slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9가-힣]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "drug"


def _first_non_empty(*values: Any) -> str | None:
    for v in values:
        if v is None:
            continue
        if isinstance(v, list) and v:
            v = v[0]
        s = str(v).strip()
        if s:
            return s
    return None


def _extract_item_name(item: dict[str, Any]) -> str | None:
    # Common keys seen across MFDS datasets
    return _first_non_empty(
        item.get("itemName"),
        item.get("ITEM_NAME"),
        item.get("ITEMNAME"),
        item.get("품목명"),
        item.get("productName"),
    )


def _extract_usage(item: dict[str, Any]) -> str:
    return (
        _first_non_empty(
            item.get("efcyQesitm"),
            item.get("EFCY_QESITM"),
            item.get("효능"),
            item.get("indications"),
        )
        or "의약품"
    )


def _extract_notes(item: dict[str, Any]) -> list[str]:
    notes: list[str] = []
    for key in ("seQesitm", "SE_QESITM", "주의사항", "warnings"):
        v = item.get(key)
        if isinstance(v, str) and v.strip():
            notes.append(v.strip())
            break

    # Keep notes short (avoid shipping huge label blocks)
    notes.append("이 정보는 공식 오픈데이터를 기반으로 자동 생성된 참고용 요약입니다.")
    notes.append("복용/상호작용은 반드시 의사/약사와 상담하세요.")
    return notes[:4]


def _extract_ingredients(item: dict[str, Any]) -> list[str]:
    # Some datasets have ingredient fields; if absent, leave empty.
    candidates = []
    for key in (
        "materialName",
        "MATERIAL_NAME",
        "성분명",
        "ingredients",
        "INGR_NAME",
    ):
        v = item.get(key)
        if isinstance(v, str) and v.strip():
            candidates.append(v.strip())
        elif isinstance(v, list):
            candidates.extend([str(x).strip() for x in v if str(x).strip()])

    cleaned: list[str] = []
    for c in candidates:
        # Split common separators
        parts = re.split(r"[,/;\n]+", c)
        cleaned.extend([p.strip() for p in parts if p.strip()])

    # Deduplicate
    uniq: list[str] = []
    seen: set[str] = set()
    for x in cleaned:
        key = x.lower()
        if key not in seen:
            uniq.append(x)
            seen.add(key)
    return uniq[:6]


def _parse_items_from_json(payload: dict[str, Any]) -> list[dict[str, Any]]:
    # Typical structure: { response: { body: { items: [...] } } }
    for path in (
        ("body", "items"),
        ("response", "body", "items"),
        ("response", "body", "items", "item"),
        ("items",),
    ):
        cur: Any = payload
        ok = True
        for p in path:
            if isinstance(cur, dict) and p in cur:
                cur = cur[p]
            else:
                ok = False
                break
        if ok and isinstance(cur, list):
            return cur
        if ok and isinstance(cur, dict) and "item" in cur and isinstance(cur["item"], list):
            return cur["item"]
    return []


def fetch_mfds_items(
    *,
    endpoint: str,
    service_key: str,
    count: int,
    timeout_s: float = 20.0,
    sleep_s: float = 0.12,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    page_size = 100

    with httpx.Client(timeout=timeout_s, headers={"User-Agent": "pill-safe-ai/0.1"}) as client:
        while len(items) < count:
            num = min(page_size, count - len(items))
            params = {
                "serviceKey": service_key,
                "type": "json",
                "numOfRows": str(num),
                "pageNo": str(page),
            }
            resp = client.get(endpoint, params=params)
            resp.raise_for_status()
            payload = resp.json()
            batch = _parse_items_from_json(payload)
            if not batch:
                break
            items.extend(batch)
            page += 1
            time.sleep(sleep_s)

    return items[:count]


def write_database(items: list[dict[str, Any]], out_path: Path, *, source: str, endpoint: str) -> int:
    drugs: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for item in items:
        name = _extract_item_name(item)
        if not name:
            continue

        base_id = _slugify(name)
        uid = base_id
        i = 2
        while uid in seen_ids:
            uid = f"{base_id}-{i}"
            i += 1
        seen_ids.add(uid)

        drug = {
            "id": uid,
            "brandNameKo": name,
            "genericName": None,
            "aliases": [],
            "ingredients": _extract_ingredients(item),
            "usage": _extract_usage(item),
            "notes": _extract_notes(item),
        }
        drugs.append(drug)

    payload = {
        "version": 1,
        "source": source,
        "generatedAt": int(time.time()),
        "meta": {"endpoint": endpoint},
        "drugs": drugs,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(drugs)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--out", type=str, default="frontend/src/data/drugDatabase.json")
    parser.add_argument("--endpoint", type=str, default=MFDS_ENDPOINT_DEFAULT)
    parser.add_argument("--service-key", type=str, default=os.getenv("MFDS_SERVICE_KEY", ""))
    args = parser.parse_args()

    if not args.service_key.strip():
        raise SystemExit(
            "MFDS_SERVICE_KEY is missing. Set env MFDS_SERVICE_KEY or pass --service-key."
        )

    items = fetch_mfds_items(endpoint=args.endpoint, service_key=args.service_key, count=args.count)
    written = write_database(items, Path(args.out), source="mfds", endpoint=args.endpoint)
    print(f"Wrote {written} entries to {args.out}")


if __name__ == "__main__":
    main()
