"""Generate a simple drug database JSON from openFDA.

Why this exists
- We should not scrape/copy arbitrary websites for drug data.
- openFDA is an official public API suitable for building a starter dataset.

What it produces
- A JSON compatible with frontend/src/data/drugDatabase.json schema used by drugMatcher.
- Fields are intentionally minimal (names + ingredients) to avoid shipping long label text.

Usage (PowerShell)
  C:/dev/pill-safe-ai/.venv/Scripts/python.exe backend/scripts/generate_drug_database_openfda.py \
    --count 300 \
    --out frontend/src/data/drugDatabase.json

Notes
- Requires outbound internet access.
- Data is largely US-market and English.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


OPENFDA_URL = "https://api.fda.gov/drug/label.json"


def _slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "drug"


def _pick_first(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, list) and value:
        v = value[0]
        return str(v) if v is not None else None
    if isinstance(value, str):
        return value
    return str(value)


def _pick_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v is not None and str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [value]
    return []


@dataclass
class DrugEntry:
    id: str
    brandNameKo: str
    genericName: str | None
    aliases: list[str]
    ingredients: list[str]
    usage: str
    notes: list[str]


def fetch_openfda_labels(count: int, *, timeout_s: float = 20.0, sleep_s: float = 0.12) -> list[dict[str, Any]]:
    """Fetch label records with openfda.brand_name present."""
    results: list[dict[str, Any]] = []
    skip = 0
    limit = 100

    with httpx.Client(timeout=timeout_s, headers={"User-Agent": "pill-safe-ai/0.1"}) as client:
        while len(results) < count:
            batch_limit = min(limit, count - len(results))
            params = {
                "search": "_exists_:openfda.brand_name",
                "limit": str(batch_limit),
                "skip": str(skip),
            }
            resp = client.get(OPENFDA_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
            batch = data.get("results", [])
            if not batch:
                break
            results.extend(batch)
            skip += batch_limit
            time.sleep(sleep_s)

    return results[:count]


def build_entries(records: list[dict[str, Any]]) -> list[DrugEntry]:
    entries: list[DrugEntry] = []
    seen_ids: set[str] = set()

    for rec in records:
        openfda = rec.get("openfda") or {}
        brand = _pick_first(openfda.get("brand_name"))
        generic = _pick_first(openfda.get("generic_name"))
        substances = _pick_list(openfda.get("substance_name"))

        if not brand:
            continue

        base_id = _slugify(brand)
        unique_id = base_id
        i = 2
        while unique_id in seen_ids:
            unique_id = f"{base_id}-{i}"
            i += 1

        seen_ids.add(unique_id)

        aliases = []
        if generic and generic.lower() != brand.lower():
            aliases.append(generic)

        # Keep usage minimal to avoid shipping long label text
        usage = "의약품 (openFDA)"
        notes = [
            "이 데이터는 openFDA에서 자동 생성된 참고용 요약입니다.",
            "복용/상호작용은 반드시 전문가와 상담하세요.",
        ]

        entries.append(
            DrugEntry(
                id=unique_id,
                brandNameKo=brand,
                genericName=generic,
                aliases=aliases,
                ingredients=substances,
                usage=usage,
                notes=notes,
            )
        )

    return entries


def write_database(entries: list[DrugEntry], out_path: Path) -> None:
    payload = {
        "version": 1,
        "source": "openfda",
        "generatedAt": int(time.time()),
        "drugs": [
            {
                "id": e.id,
                "brandNameKo": e.brandNameKo,
                "genericName": e.genericName,
                "aliases": e.aliases,
                "ingredients": e.ingredients,
                "usage": e.usage,
                "notes": e.notes,
            }
            for e in entries
        ],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--out", type=str, default="frontend/src/data/drugDatabase.json")
    args = parser.parse_args()

    records = fetch_openfda_labels(args.count)
    entries = build_entries(records)
    write_database(entries, Path(args.out))
    print(f"Wrote {len(entries)} entries to {args.out}")


if __name__ == "__main__":
    main()
