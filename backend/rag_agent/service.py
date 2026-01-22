from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .index import RagIndex
from .sources import RagDocument, build_default_documents


def default_index_path() -> Path:
    here = Path(__file__).resolve().parents[1]  # backend/
    return Path(os.getenv("RAG_INDEX_PATH", str(here / "rag_agent" / "rag_index.pkl")))


class RagService:
    def __init__(self) -> None:
        self._index = RagIndex()
        self._loaded = False

    @property
    def index(self) -> RagIndex:
        return self._index

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        path = default_index_path()
        if self._index.load(path):
            self._loaded = True
            return
        # Build on-demand if no persisted index exists
        self.rebuild(save=True)

    def rebuild(self, *, save: bool = True) -> Dict[str, Any]:
        docs = build_default_documents()
        self._index.build(docs)
        self._loaded = True
        path = default_index_path()
        if save:
            self._index.save(path)
        return {
            "ok": True,
            "docCount": self._index.size,
            "indexPath": str(path),
        }

    def answer(self, query: str, *, k: int = 5) -> Dict[str, Any]:
        self.ensure_loaded()
        raw_contexts = self._index.query(query, k=k)

        q_norm = re.sub(r"\s+", " ", (query or "").strip().lower())

        def _intent(q: str) -> str:
            # Very small heuristic router to reduce unsafe synthesis.
            if any(x in q for x in ["상호작", "병용", "같이", "동시", "중복", "함께"]):
                return "interaction"
            if any(x in q for x in ["주의", "부작", "부작용", "금기", "복용", "먹어", "먹으면", "용법", "용량"]):
                return "safety"
            if any(x in q for x in ["성분", "ingredient", "성분명", "유효성분"]):
                return "ingredient"
            return "general"

        intent = _intent(q_norm)

        def _snippet(text: str, *, limit: int = 280) -> str:
            s = re.sub(r"\s+", " ", (text or "").strip())
            if len(s) <= limit:
                return s
            return s[: max(0, limit - 1)] + "…"

        def _clarifying_questions(q: str) -> List[str]:
            q = (q or "").strip()
            # Keep this short: too many questions reduces usability.
            return [
                "확인할 약의 정확한 제품명(또는 성분명)과 함량/제형(예: 500mg 정)까지 알려줄 수 있나요?",
                "현재 함께 복용 중인 다른 약/영양제(이름, 가능하면 성분)도 있나요?",
                "연령대, 임신/수유 여부, 간/신장 질환 또는 알레르기 정보가 있나요?",
            ]

        # Filter to evidence-worthy contexts (reduce hallucination risk)
        min_score = float(os.getenv("RAG_MIN_SCORE", "0.12"))
        strict = os.getenv("RAG_STRICT", "1").strip().lower() not in {"0", "false", "no", "off"}
        if strict:
            # Slightly higher threshold in strict mode.
            min_score = max(min_score, 0.15)

        contexts = [c for c in raw_contexts if float(c.get("score") or 0) >= min_score]

        evidence = []
        kinds_seen: set[str] = set()
        for c in contexts[: max(1, int(k))]:
            title = str(c.get("title") or "").strip()
            text = str(c.get("text") or "").strip()
            meta = c.get("meta") if isinstance(c.get("meta"), dict) else {}
            src = str(meta.get("source") or "RAG")
            kind = str(meta.get("kind") or "").strip()
            if kind:
                kinds_seen.add(kind)
            evidence.append(
                {
                    "source": "RAG",
                    "id": str(c.get("id") or ""),
                    "field": f"{src}{(':'+kind) if kind else ''}",
                    "snippet": _snippet(f"[{title}] {text}" if title else text),
                }
            )

        # Strict mode: prevent generic 'tips' from being the only evidence for safety/interaction questions.
        if strict and evidence:
            only_tips = kinds_seen == {"tip"}
            if only_tips and intent in {"interaction", "safety", "ingredient"}:
                evidence = []

        if not evidence:
            return {
                "ok": True,
                "answer": "제공된 지식베이스에서 질문과 직접적으로 매칭되는 근거를 찾지 못해요. 확인 가능한 정보만으로는 단정해서 답변할 수 없습니다.",
                "safety_level": "unknown",
                "key_points": ["근거 부족으로 결론을 내릴 수 없음"],
                "questions_needed": _clarifying_questions(query),
                "evidence": [],
                "not_in_context": ["질문에 대한 직접 근거(지식베이스)"],
            }

        # Conservative synthesis: only summarize what appears in evidence snippets.
        key_points = []
        for ev in evidence[:3]:
            sn = str(ev.get("snippet") or "").strip()
            if sn:
                key_points.append(_snippet(sn, limit=120))

        # Compute safety level ONLY when explicitly stated in evidence.
        safety_level = "unknown"
        joined = "\n".join([str(ev.get("snippet") or "") for ev in evidence]).lower()
        if any(x in joined for x in ["병용 금기", "contraind", "금기:"]):
            safety_level = "avoid"
        elif any(x in joined for x in ["중요도: high", "severity: high"]):
            safety_level = "avoid"
        elif any(x in joined for x in ["중요도: medium", "severity: medium", "주의:", "주의사항"]):
            safety_level = "caution"

        answer_lines = [
            "아래 내용은 제공된 지식베이스의 근거에서 확인되는 정보만 요약합니다.",
        ]
        for ev in evidence[:3]:
            answer_lines.append(f"- {ev.get('snippet','')}")

        return {
            "ok": True,
            "answer": "\n".join(answer_lines).strip(),
            "safety_level": safety_level,
            "key_points": key_points,
            "questions_needed": [],
            "evidence": evidence,
            "not_in_context": [],
        }
