from __future__ import annotations

import os
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .index import RagIndex
from .sources import build_default_documents
from .prompt_templates import rag_prompt_bundle

try:
    from langchain_openai import ChatOpenAI  # type: ignore
except Exception:  # pragma: no cover
    ChatOpenAI = None  # type: ignore


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
        self.rebuild(save=True)

    def rebuild(self, *, save: bool = True) -> Dict[str, Any]:
        docs = build_default_documents()
        self._index.build(docs)
        self._loaded = True
        path = default_index_path()
        if save:
            self._index.save(path)
        return {"ok": True, "docCount": self._index.size, "indexPath": str(path)}

    def _deterministic_answer(self, query: str, *, k: int = 5) -> Dict[str, Any]:
        """Deterministic RAG answer with strict evidence gating."""

        self.ensure_loaded()
        q_norm = re.sub(r"\s+", " ", (query or "").strip().lower())

        def _intent(q: str) -> str:
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
            return [
                "확인할 약의 정확한 제품명(또는 성분명)과 함량/제형(예: 500mg 정)까지 알려줄 수 있나요?",
                "현재 함께 복용 중인 다른 약/영양제(이름, 가능하면 성분)도 있나요?",
                "연령대, 임신/수유 여부, 간/신장 질환 또는 알레르기 정보가 있나요?",
            ]

        raw_contexts = self._index.query(query, k=max(1, min(int(k or 5), 10)))

        min_score = float(os.getenv("RAG_MIN_SCORE", "0.12") or "0.12")
        strict = os.getenv("RAG_STRICT", "1").strip().lower() not in {"0", "false", "no", "off"}
        if strict:
            min_score = max(min_score, 0.15)

        contexts = [c for c in raw_contexts if float(c.get("score") or 0) >= min_score]

        evidence: list[dict] = []
        kinds_seen: set[str] = set()
        for c in contexts[: max(1, int(k or 5))]:
            title = str(c.get("title") or "").strip()
            text = str(c.get("text") or "").strip()
            meta_raw = c.get("meta")
            meta: dict[str, Any] = meta_raw if isinstance(meta_raw, dict) else {}
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

        key_points: list[str] = []
        for ev in evidence[:3]:
            sn = str(ev.get("snippet") or "").strip()
            if sn:
                key_points.append(_snippet(sn, limit=120))

        safety_level = "unknown"
        joined = "\n".join([str(ev.get("snippet") or "") for ev in evidence]).lower()
        if any(x in joined for x in ["병용 금기", "병용금기", "contraind", "금기:"]):
            safety_level = "avoid"
        elif any(x in joined for x in ["중요도: medium", "severity: medium", "주의:", "주의사항"]):
            safety_level = "caution"

        answer_lines = ["아래 내용은 제공된 지식베이스의 근거에서 확인되는 정보만 요약합니다."]
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

    def _friendli_llm(self) -> Optional[Any]:
        """Create a Friendli-backed ChatOpenAI instance.

        Uses FRIENDLI_TOKEN env var only (no hardcoded secrets).
        """

        if ChatOpenAI is None:
            return None
        token = (os.getenv("FRIENDLI_TOKEN") or "").strip()
        if not token:
            return None
        return ChatOpenAI(
            base_url="https://api.friendli.ai/serverless/v1",
            api_key=(lambda: token),
            model="LGAI-EXAONE/K-EXAONE-236B-A23B",
            streaming=True,
        )

    def answer(self, query: str, *, k: int = 5, tools_output: str = "") -> Dict[str, Any]:
        """LLM-backed RAG answer (JSON), with deterministic fallback.

        The LLM is asked to strictly follow the prompt_templates JSON schema.
        """

        llm = self._friendli_llm()
        if llm is None:
            return self._deterministic_answer(query, k=k)

        self.ensure_loaded()
        prompts = rag_prompt_bundle()
        strict = prompts.get("templates", {}).get("strict", {})
        system = str(strict.get("system") or "")
        developer = str(strict.get("developer") or "")
        user_t = str(strict.get("user") or "")

        raw_contexts = self._index.query(query, k=max(1, min(int(k or 5), 10)))
        min_score = float(os.getenv("RAG_MIN_SCORE", "0.12") or "0.12")
        strict_mode = os.getenv("RAG_STRICT", "1").strip().lower() not in {"0", "false", "no", "off"}
        if strict_mode:
            min_score = max(min_score, 0.15)
        contexts = [c for c in raw_contexts if float(c.get("score") or 0) >= min_score]

        evidence_texts: list[str] = []
        for c in contexts[: max(1, int(k or 5))]:
            title = str(c.get("title") or "").strip()
            text = str(c.get("text") or "").strip()
            if not (title or text):
                continue
            evidence_texts.append(f"[{title}] {text}" if title else text)
        context_text = "\n".join(evidence_texts).strip()

        user_message = user_t.format(
            question=query,
            context=context_text,
            tools_output=(tools_output or "").strip(),
        )

        # Prefer a 2-message format; append developer instructions into system to keep deps minimal.
        system_full = (system + "\n\n" + developer).strip() if developer else system.strip()

        try:
            resp = llm.invoke([("system", system_full), ("user", user_message)])
            content = str(getattr(resp, "content", "") or "").strip()
        except Exception:
            return self._deterministic_answer(query, k=k)

        # Parse strict JSON output; fallback if the model violated format.
        try:
            payload = json.loads(content)
        except Exception:
            return {
                **self._deterministic_answer(query, k=k),
                "not_in_context": ["LLM 출력(JSON) 파싱 실패"],
            }

        if not isinstance(payload, dict):
            return {
                **self._deterministic_answer(query, k=k),
                "not_in_context": ["LLM 출력이 JSON 객체가 아님"],
            }

        # Light sanitize to expected keys
        out: Dict[str, Any] = {
            "ok": True,
            "answer": str(payload.get("answer") or "").strip(),
            "safety_level": str(payload.get("safety_level") or "unknown").strip() or "unknown",
            "key_points": payload.get("key_points") if isinstance(payload.get("key_points"), list) else [],
            "questions_needed": payload.get("questions_needed") if isinstance(payload.get("questions_needed"), list) else [],
            "evidence": payload.get("evidence") if isinstance(payload.get("evidence"), list) else [],
            "not_in_context": payload.get("not_in_context") if isinstance(payload.get("not_in_context"), list) else [],
        }

        if not out["answer"]:
            out["answer"] = self._deterministic_answer(query, k=k).get("answer", "")

        return out

    def stream_answer(self, query: str, *, k: int = 5, tools_output: str = "") -> Iterable[str]:
        """Stream an LLM response when configured; otherwise stream deterministic text."""

        llm = self._friendli_llm()
        if llm is None:
            payload = self._deterministic_answer(query, k=k)
            text = str(payload.get("answer") or "")
            if not text:
                return
            for line in text.splitlines():
                s = (line or "").rstrip()
                if not s:
                    yield "\n"
                    continue
                while s:
                    yield s[:120]
                    s = s[120:]
                yield "\n"
            return

        self.ensure_loaded()
        prompts = rag_prompt_bundle()
        strict = prompts.get("templates", {}).get("strict", {})
        system = str(strict.get("system") or "")
        developer = str(strict.get("developer") or "")
        user_t = str(strict.get("user") or "")

        raw_contexts = self._index.query(query, k=max(1, min(int(k or 5), 10)))
        min_score = float(os.getenv("RAG_MIN_SCORE", "0.12") or "0.12")
        strict_mode = os.getenv("RAG_STRICT", "1").strip().lower() not in {"0", "false", "no", "off"}
        if strict_mode:
            min_score = max(min_score, 0.15)
        contexts = [c for c in raw_contexts if float(c.get("score") or 0) >= min_score]

        evidence_texts: list[str] = []
        for c in contexts[: max(1, int(k or 5))]:
            title = str(c.get("title") or "").strip()
            text = str(c.get("text") or "").strip()
            if not (title or text):
                continue
            evidence_texts.append(f"[{title}] {text}" if title else text)
        context_text = "\n".join(evidence_texts).strip()

        user_message = user_t.format(
            question=query,
            context=context_text,
            tools_output=(tools_output or "").strip(),
        )
        system_full = (system + "\n\n" + developer).strip() if developer else system.strip()

        for chunk in llm.stream([("system", system_full), ("user", user_message)]):
            content = str(getattr(chunk, "content", "") or "")
            if content:
                yield content