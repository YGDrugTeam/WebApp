from __future__ import annotations

import os
import math
import pickle
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .sources import RagDocument


_RAG_INDEX_VERSION = 4


def _char_ngrams(text: str, n: int = 3) -> List[str]:
    # Basic normalization for Korean+English brand queries
    s = re.sub(r"\s+", " ", (text or "").strip().lower())
    if not s:
        return []
    # Keep letters/numbers/Korean; replace other punctuation with space
    s = re.sub(r"[^0-9a-z\u3131-\u3163\uac00-\ud7a3 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) <= n:
        return [s]
    grams: List[str] = []
    # Remove spaces for char grams while keeping a bit of word-boundary signal
    s2 = s.replace(" ", "_")
    for i in range(0, len(s2) - n + 1):
        grams.append(s2[i : i + n])
    return grams


@dataclass
class _DocVector:
    doc: RagDocument
    vec: Dict[str, float]
    norm: float


class RagIndex:
    """Tiny TF-IDF index using character trigrams (dependency-free)."""

    def __init__(self) -> None:
        self._docs: List[RagDocument] = []
        self._df: Dict[str, int] = {}
        self._vectors: List[_DocVector] = []

    @property
    def size(self) -> int:
        return len(self._docs)

    def build(self, docs: Sequence[RagDocument]) -> None:
        self._docs = list(docs)
        self._df = {}

        # document frequency
        for doc in self._docs:
            grams = set(_char_ngrams(doc.title + "\n" + doc.text))
            for g in grams:
                self._df[g] = self._df.get(g, 0) + 1

        n_docs = max(1, len(self._docs))

        def idf(df: int) -> float:
            # Smooth IDF
            return math.log((n_docs + 1.0) / (df + 1.0)) + 1.0

        self._vectors = []
        for doc in self._docs:
            grams = _char_ngrams(doc.title + "\n" + doc.text)
            tf: Dict[str, int] = {}
            for g in grams:
                tf[g] = tf.get(g, 0) + 1

            vec: Dict[str, float] = {}
            for g, cnt in tf.items():
                w = float(cnt) * idf(self._df.get(g, 0))
                vec[g] = w

            norm = math.sqrt(sum(w * w for w in vec.values())) or 1.0
            self._vectors.append(_DocVector(doc=doc, vec=vec, norm=norm))

    def save(self, path: str | Path) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": _RAG_INDEX_VERSION,
            "docs": self._docs,
            "df": self._df,
            "vectors": [(dv.doc.id, dv.vec, dv.norm) for dv in self._vectors],
        }
        with p.open("wb") as f:
            pickle.dump(payload, f)

    def load(self, path: str | Path) -> bool:
        p = Path(path)
        if not p.exists():
            return False

        try:
            with p.open("rb") as f:
                payload = pickle.load(f)
        except Exception:
            # If the pickle was created under a different module path
            # (e.g., "rag_agent" vs "backend.rag_agent"), unpickling can fail.
            # In that case, return False so callers can rebuild the index.
            return False

        docs = payload.get("docs")
        df = payload.get("df")
        vectors = payload.get("vectors")
        version = payload.get("version")
        if version != _RAG_INDEX_VERSION:
            return False
        if not isinstance(docs, list) or not isinstance(df, dict) or not isinstance(vectors, list):
            return False

        self._docs = docs
        self._df = {str(k): int(v) for k, v in df.items()}
        by_id = {d.id: d for d in self._docs if isinstance(d, RagDocument)}

        self._vectors = []
        for doc_id, vec, norm in vectors:
            d = by_id.get(str(doc_id))
            if d is None:
                continue
            if not isinstance(vec, dict):
                continue
            v2 = {str(k): float(v) for k, v in vec.items()}
            n2 = float(norm) if isinstance(norm, (int, float)) else 1.0
            self._vectors.append(_DocVector(doc=d, vec=v2, norm=n2 or 1.0))

        return True

    def query(self, q: str, *, k: int = 5) -> List[Dict[str, Any]]:
        query_grams = _char_ngrams(q)
        if not query_grams:
            return []

        # Build query vector
        tf: Dict[str, int] = {}
        for g in query_grams:
            tf[g] = tf.get(g, 0) + 1

        n_docs = max(1, len(self._docs))

        def idf(df: int) -> float:
            return math.log((n_docs + 1.0) / (df + 1.0)) + 1.0

        qvec: Dict[str, float] = {}
        for g, cnt in tf.items():
            qvec[g] = float(cnt) * idf(self._df.get(g, 0))

        qnorm = math.sqrt(sum(w * w for w in qvec.values())) or 1.0

        scored: List[Tuple[float, RagDocument]] = []
        for dv in self._vectors:
            dot = 0.0
            for g, qw in qvec.items():
                dw = dv.vec.get(g)
                if dw:
                    dot += qw * dw
            score = dot / (qnorm * dv.norm)
            if score > 0:
                scored.append((score, dv.doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[: max(1, int(k))]

        out: List[Dict[str, Any]] = []
        for score, doc in top:
            out.append(
                {
                    "id": doc.id,
                    "title": doc.title,
                    "text": doc.text,
                    "score": round(float(score), 4),
                    "meta": doc.meta,
                }
            )
        return out
