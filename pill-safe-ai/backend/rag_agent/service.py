from __future__ import annotations

import os
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
        contexts = self._index.query(query, k=k)

        # No LLM wired yet: return a deterministic, UI-ready response.
        if not contexts:
            return {
                "ok": True,
                "answer": "관련 자료를 찾지 못했어요. 약 이름을 더 구체적으로 입력하거나(예: '타이레놀정 500mg'), 성분명으로도 시도해 주세요.",
                "contexts": [],
            }

        # Simple synthesis: surface the best snippet(s)
        top = contexts[0]
        answer = f"가장 관련 있는 자료: {top.get('title','')}\n\n{top.get('text','')}"
        return {"ok": True, "answer": answer, "contexts": contexts}
