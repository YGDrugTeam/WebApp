import csv
import os
import threading
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Optional


@dataclass(frozen=True)
class LocalDrugRow:
    name: str
    company: str
    dosage: str
    efficacy: str


class LocalDrugDB:
    """Lightweight CSV-backed drug lookup.

    This intentionally avoids heavy deps (pandas/thefuzz). Matching uses difflib.

    Expected columns (Korean): 제품명, 회사, 복용횟수, 효능
    If headers are missing/unreadable, we fall back to the first 4 columns.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._path: str = ""
        self._rows: list[LocalDrugRow] = []

    def configured_path(self) -> str:
        raw = (os.getenv("LOCAL_DRUG_DB_PATH") or "").strip()
        if raw:
            return raw
        # Default location inside the backend folder
        here = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(here, "data", "local_drug_db.csv")

    def status(self) -> dict[str, Any]:
        path = self.configured_path()
        with self._lock:
            loaded = bool(self._rows) and self._path == path
            count = len(self._rows) if loaded else 0
        return {
            "configuredPath": path,
            "exists": os.path.exists(path),
            "loaded": loaded,
            "count": count,
        }

    def ensure_loaded(self) -> None:
        path = self.configured_path()
        with self._lock:
            if self._rows and self._path == path:
                return
        rows = self._load_csv_rows(path)
        with self._lock:
            self._path = path
            self._rows = rows

    def save_bytes(self, content: bytes, *, path: Optional[str] = None) -> str:
        target = path or self.configured_path()
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(content)
        # Force reload
        with self._lock:
            self._path = ""
            self._rows = []
        self.ensure_loaded()
        return target

    def search_best(self, query: str, *, limit: int = 3) -> list[dict[str, Any]]:
        q = (query or "").strip()
        if not q:
            return []
        self.ensure_loaded()
        with self._lock:
            rows = list(self._rows)

        qn = self._norm(q)
        scored: list[tuple[float, LocalDrugRow]] = []
        for r in rows:
            rn = self._norm(r.name)
            if not rn:
                continue
            # quick substring boost
            if qn and qn in rn:
                score = 1.0
            else:
                score = SequenceMatcher(None, qn, rn).ratio()
            scored.append((score, r))

        scored.sort(key=lambda x: x[0], reverse=True)
        out: list[dict[str, Any]] = []
        for score, r in scored[: max(0, int(limit or 3))]:
            out.append(
                {
                    "name": r.name,
                    "company": r.company,
                    "dosage": r.dosage,
                    "efficacy": r.efficacy,
                    "score": round(float(score) * 100, 1),
                }
            )
        return out

    def tools_output_for_text(self, qtext: str, *, max_hits: int = 2) -> str:
        q = (qtext or "").strip()
        if not q:
            return "LOCAL_DB: empty_query"
        st = self.status()
        if not st.get("exists"):
            return "LOCAL_DB: 미구성(LOCAL_DRUG_DB_PATH 파일 없음)"

        hits = self.search_best(q, limit=max_hits)
        if not hits:
            return "LOCAL_DB: 일치 항목 없음"

        eff_limit = int(os.getenv("LOCAL_DB_EFFICACY_MAX_CHARS", "180") or "180")
        eff_limit = max(40, min(eff_limit, 600))
        line_limit = int(os.getenv("LOCAL_DB_LINE_MAX_CHARS", "900") or "900")
        line_limit = max(200, min(line_limit, 1600))

        lines = ["LOCAL_DB_RESULTS:"]
        for h in hits[:max_hits]:
            parts: list[str] = []
            if h.get("company"):
                parts.append(f"회사: {self._clean_text(str(h['company']), limit=80)}")
            if h.get("dosage"):
                parts.append(f"복용: {self._clean_text(str(h['dosage']), limit=80)}")
            if h.get("efficacy"):
                eff = self.summarize_text(str(h["efficacy"]), limit=eff_limit)
                if eff:
                    parts.append(f"효능: {eff}")
            meta = " | ".join(parts).strip()
            nm = str(h.get("name") or "").strip()
            sc = h.get("score")
            score_tag = f" (유사도 {sc}%)" if sc is not None else ""
            lines.append(f"- [{nm}]{score_tag} {meta}"[:line_limit])
        return "\n".join(lines).strip()

    def summarize_text(self, text: str, *, limit: int = 180) -> str:
        """Summarize long Korean-ish fields to keep prompts small.

        This is a deterministic, loss-minimizing summary: first sentence-ish chunk,
        then hard truncate.
        """

        limit = max(20, int(limit or 180))
        cleaned = self._clean_text(text, limit=max(limit * 2, 120))
        if not cleaned:
            return ""

        # Prefer splitting by common sentence boundaries.
        for sep in [". ", ".", "\n", "•", "- ", "※", ";"]:
            if sep in cleaned:
                head = cleaned.split(sep, 1)[0].strip()
                if 12 <= len(head) <= limit:
                    return head

        # If still long, truncate.
        if len(cleaned) > limit:
            return cleaned[:limit].rstrip() + "…"
        return cleaned

    @staticmethod
    def _clean_text(text: str, *, limit: int = 400) -> str:
        s = str(text or "")
        s = " ".join(s.replace("\t", " ").replace("\r", "\n").split())
        if limit > 0 and len(s) > limit:
            return s[:limit].rstrip() + "…"
        return s

    @staticmethod
    def _norm(s: str) -> str:
        return "".join(str(s or "").strip().lower().split())

    @staticmethod
    def _decode_bytes(content: bytes) -> str:
        # common encodings for Korean CSV exports
        for enc in ("utf-8-sig", "cp949", "euc-kr", "utf-8"):
            try:
                return content.decode(enc)
            except Exception:
                continue
        # last resort
        return content.decode("utf-8", errors="replace")

    def _load_csv_rows(self, path: str) -> list[LocalDrugRow]:
        if not path or not os.path.exists(path):
            return []

        content = b""
        try:
            with open(path, "rb") as f:
                content = f.read()
        except Exception:
            return []

        text = self._decode_bytes(content)
        # Feed csv reader with text lines
        lines = text.splitlines()
        if not lines:
            return []

        reader = csv.reader(lines)
        try:
            header = next(reader)
        except Exception:
            return []

        header_norm = [str(h or "").strip() for h in header]
        idx = self._map_header_indices(header_norm)

        out: list[LocalDrugRow] = []
        for row in reader:
            if not row or all(not str(x or "").strip() for x in row):
                continue
            name = self._get_col(row, idx.get("name"))
            if not name:
                continue
            out.append(
                LocalDrugRow(
                    name=name,
                    company=self._get_col(row, idx.get("company")),
                    dosage=self._get_col(row, idx.get("dosage")),
                    efficacy=self._get_col(row, idx.get("efficacy")),
                )
            )
        return out

    @staticmethod
    def _get_col(row: list[Any], i: Optional[int]) -> str:
        if i is None:
            return ""
        try:
            return str(row[i] or "").strip()
        except Exception:
            return ""

    @staticmethod
    def _map_header_indices(header: list[str]) -> dict[str, Optional[int]]:
        # Direct matches first
        def find_one(candidates: list[str]) -> Optional[int]:
            for c in candidates:
                for i, h in enumerate(header):
                    if str(h).strip() == c:
                        return i
            return None

        name_i = find_one(["제품명", "상품명", "약품명", "품목명"])
        company_i = find_one(["회사", "제조사", "업체", "제약사"])
        dosage_i = find_one(["복용횟수", "복용법", "용법", "용량"])
        efficacy_i = find_one(["효능", "효과", "효능효과"])

        # If headers are garbage/unreadable, fall back to positional columns
        if name_i is None and len(header) >= 1:
            name_i = 0
        if company_i is None and len(header) >= 2:
            company_i = 1
        if dosage_i is None and len(header) >= 3:
            dosage_i = 2
        if efficacy_i is None and len(header) >= 4:
            efficacy_i = 3

        return {"name": name_i, "company": company_i, "dosage": dosage_i, "efficacy": efficacy_i}
