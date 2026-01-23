import json
import os
from functools import lru_cache


def _normalize(value: str) -> str:
    return (
        str(value or "")
        .lower()
        .replace("\n", " ")
        .replace("\r", " ")
        .replace("\t", " ")
    )


def _sanitize(value: str) -> str:
    # Keep Korean/English/digits and a few dosage symbols
    out = []
    for ch in _normalize(value):
        if ch.isalnum() or ch in {" ", ".", "+", "-"} or ("가" <= ch <= "힣"):
            out.append(ch)
        else:
            out.append(" ")
    return " ".join("".join(out).split())


def _score_match(query: str, target: str) -> int:
    if not query or not target:
        return 0

    if query == target:
        return 100
    if target.find(query) >= 0:
        return 85
    if query.find(target) >= 0:
        return 80

    q_tokens = {t for t in query.split(" ") if t}
    t_tokens = {t for t in target.split(" ") if t}
    if not q_tokens or not t_tokens:
        return 0

    inter = len(q_tokens.intersection(t_tokens))
    union = len(q_tokens) + len(t_tokens) - inter
    return int(round((inter / union) * 60))


def extract_candidates(text: str) -> list[str]:
    normalized = _sanitize(text)
    if not normalized:
        return []

    tokens = [t.strip() for t in normalized.replace("/", " ").replace(",", " ").split(" ") if t.strip()]

    # preserve longer chunks too
    chunks = [c.strip() for c in text.splitlines() if c.strip()]

    uniq: list[str] = []
    seen = set()
    for c in chunks + tokens:
        cc = str(c).strip()
        if len(cc) < 2:
            continue
        key = _normalize(cc)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(cc)
        if len(uniq) >= 25:
            break

    return uniq


@lru_cache(maxsize=1)
def load_drug_database() -> dict:
    """Try to load the frontend drug DB for consistent matching."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "drugDatabase.json"),
        os.path.join(here, "..", "frontend", "src", "data", "drugDatabase.json"),
        os.path.join(here, "..", "..", "frontend", "src", "data", "drugDatabase.json"),
    ]

    for path in candidates:
        path = os.path.abspath(path)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)

    return {"drugs": []}


def match_drug(raw_text: str, threshold: int = 60) -> dict:
    q = _sanitize(raw_text)
    if not q:
        return {"canonicalName": "", "matched": False, "score": 0, "drug": None}

    db = load_drug_database()
    drugs = db.get("drugs") or []

    best = None
    best_score = 0

    for drug in drugs:
        name = _sanitize(drug.get("name", ""))
        score = _score_match(q, name)
        for alias in drug.get("aliases") or []:
            score = max(score, _score_match(q, _sanitize(alias)))

        if score > best_score:
            best_score = score
            best = drug

    matched = best is not None and best_score >= threshold
    canonical = (best.get("name") if best is not None else "") if matched else str(raw_text).strip()

    return {"canonicalName": canonical, "matched": matched, "score": best_score, "drug": best if matched else None}
