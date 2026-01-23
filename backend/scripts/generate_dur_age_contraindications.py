from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


CANDIDATE_ENCODINGS: list[str] = [
    "utf-8-sig",
    "utf-8",
    "cp949",
    "euc-kr",
    "utf-16",
    "utf-16-le",
    "utf-16-be",
]


def _detect_bom(data: bytes) -> str | None:
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if data.startswith(b"\xff\xfe"):
        return "utf-16-le"
    if data.startswith(b"\xfe\xff"):
        return "utf-16-be"
    return None


def _decode_with_fallback(data: bytes, preferred: str | None = None) -> tuple[str, str]:
    bom = _detect_bom(data)
    if bom:
        preferred = bom

    if preferred:
        try:
            return data.decode(preferred), preferred
        except UnicodeDecodeError:
            pass

    for enc in CANDIDATE_ENCODINGS:
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue

    raise UnicodeDecodeError("unknown", b"", 0, 1, "No candidate encoding worked")


def normalize_ingredient_key(text: str) -> str:
    s = (text or "").strip().lower()
    # keep ascii letters/numbers only; this aligns with frontend ingredient keys
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


@dataclass(frozen=True)
class AgeRange:
    min_age: int | None
    min_inclusive: bool
    max_age: int | None
    max_inclusive: bool


_RE_RANGE = re.compile(
    r"(?P<n1>\d+)\s*세\s*(?P<op1>미만|이하|이상|초과)",
)


def parse_age_ranges(text: str) -> list[AgeRange]:
    t = (text or "").strip()
    if not t or t == "-":
        return []

    ranges: list[AgeRange] = []

    # Handle multiple patterns within a single string.
    for m in _RE_RANGE.finditer(t):
        n = int(m.group("n1"))
        op = m.group("op1")

        if op == "미만":
            # age < n
            ranges.append(AgeRange(min_age=None, min_inclusive=True, max_age=n, max_inclusive=False))
        elif op == "이하":
            # age <= n
            ranges.append(AgeRange(min_age=None, min_inclusive=True, max_age=n, max_inclusive=True))
        elif op == "이상":
            # age >= n
            ranges.append(AgeRange(min_age=n, min_inclusive=True, max_age=None, max_inclusive=True))
        elif op == "초과":
            # age > n
            ranges.append(AgeRange(min_age=n, min_inclusive=False, max_age=None, max_inclusive=True))

    # Heuristic fallback for datasets that don't include explicit numeric ages.
    # This is intentionally conservative and only used when we found no numeric ages.
    if not ranges:
        low = t.lower()
        if any(k in t for k in ["노인", "고령"]):
            ranges.append(AgeRange(min_age=65, min_inclusive=True, max_age=None, max_inclusive=True))
        elif any(k in t for k in ["소아", "어린", "영아", "유아", "청소년"]):
            ranges.append(AgeRange(min_age=None, min_inclusive=True, max_age=18, max_inclusive=False))
        elif "미확립" in t or "안전성" in t and "미확립" in t:
            ranges.append(AgeRange(min_age=None, min_inclusive=True, max_age=18, max_inclusive=False))

    return ranges


def age_applies(age_years: int, ranges: list[AgeRange]) -> bool:
    if not ranges:
        return False

    for r in ranges:
        ok = True
        if r.min_age is not None:
            ok = ok and (age_years >= r.min_age if r.min_inclusive else age_years > r.min_age)
        if r.max_age is not None:
            ok = ok and (age_years <= r.max_age if r.max_inclusive else age_years < r.max_age)
        if ok:
            return True

    return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert DUR age contraindication CSV to a compact JSON for the frontend.",
    )
    parser.add_argument("--csv", required=True, help="Input CSV path (cp949/euc-kr/utf-8 supported)")
    parser.add_argument(
        "--out",
        default="frontend/src/data/durAgeContraindications.json",
        help="Output JSON path (default: frontend/src/data/durAgeContraindications.json)",
    )
    parser.add_argument(
        "--max-rows",
        type=int,
        default=0,
        help="Limit number of rows for debugging (0 = no limit)",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv)
    raw = csv_path.read_bytes()
    text, encoding = _decode_with_fallback(raw)

    rows = []
    reader = csv.DictReader(text.splitlines())
    for idx, row in enumerate(reader):
        if args.max_rows and idx >= args.max_rows:
            break

        type_name = (row.get("TYPE_NAME") or "").strip()
        if type_name and type_name not in {"특정연령대금기", "연령금기"}:
            # Keep only age-related rows if TYPE_NAME is present.
            continue

        ingr_eng = (row.get("INGR_ENG_NAME") or "").strip()
        ingr_ko = (row.get("INGR_NAME") or "").strip()
        key_source = ingr_eng or ""
        ingredient_key = normalize_ingredient_key(key_source)

        prohibit = (row.get("PROHBT_CONTENT") or "").strip()
        remark = (row.get("REMARK") or "").strip()

        age_ranges = parse_age_ranges(prohibit)

        rows.append(
            {
                "typeName": type_name or None,
                "mixType": (row.get("MIX_TYPE") or "").strip() or None,
                "ingredientCode": (row.get("INGR_CODE") or "").strip() or None,
                "ingredientNameEn": ingr_eng or None,
                "ingredientNameKo": ingr_ko or None,
                "ingredientKey": ingredient_key or None,
                "className": (row.get("CLASS_NAME") or "").strip() or None,
                "formName": (row.get("FORM_NAME") or "").strip() or None,
                "notificationDate": (row.get("NOTIFICATION_DATE") or "").strip() or None,
                "prohibitContent": prohibit or None,
                "remark": remark or None,
                "ageRanges": [
                    {
                        "minAge": r.min_age,
                        "minInclusive": r.min_inclusive,
                        "maxAge": r.max_age,
                        "maxInclusive": r.max_inclusive,
                    }
                    for r in age_ranges
                ],
            }
        )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "version": 1,
        "source": "DUR age contraindications CSV",
        "sourceEncodingDetected": encoding,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "rowCount": len(rows),
        "rules": rows,
        "notes": [
            "This file is generated from a DUR CSV. Do not hand-edit; re-run the generator.",
            "ageRanges parsing is best-effort; unmatched rows may have empty ageRanges.",
        ],
    }

    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"read: {csv_path}")
    print(f"detected_encoding: {encoding}")
    print(f"wrote: {out_path} (rules={len(rows)})")

    # Simple sanity: show a few rows that would match a typical pediatric range.
    sample_age = 5
    hits = [r for r in rows if r.get("ageRanges") and age_applies(sample_age, [AgeRange(x["minAge"], x["minInclusive"], x["maxAge"], x["maxInclusive"]) for x in r["ageRanges"]])]
    if hits:
        print(f"sample_hits_for_age_{sample_age}: {len(hits)}")


if __name__ == "__main__":
    main()
