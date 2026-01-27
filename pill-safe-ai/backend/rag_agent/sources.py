from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


@dataclass(frozen=True)
class RagDocument:
    id: str
    title: str
    text: str
    meta: Dict[str, Any]


def _repo_root() -> Path:
    # backend/rag_agent/sources.py -> repo root is parents[2]
    return Path(__file__).resolve().parents[2]


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _docs_from_medical_knowledge(payload: Dict[str, Any]) -> List[RagDocument]:
    docs: List[RagDocument] = []

    meta = payload.get("metadata") or {}
    version = str(meta.get("version") or "")
    last_updated = str(meta.get("lastUpdated") or "")

    def add(doc_id: str, title: str, text: str, extra_meta: Optional[Dict[str, Any]] = None) -> None:
        t = (text or "").strip()
        if not t:
            return
        docs.append(
            RagDocument(
                id=doc_id,
                title=(title or "").strip() or doc_id,
                text=t,
                meta={
                    "source": "medicalKnowledge.json",
                    "version": version,
                    "lastUpdated": last_updated,
                    **(extra_meta or {}),
                },
            )
        )

    tips = payload.get("generalTips")
    if isinstance(tips, list):
        for i, tip in enumerate(tips):
            if isinstance(tip, str):
                add(f"mk.tip.{i}", "일반 복약 팁", tip, {"kind": "tip", "index": i})

    brand_dict = payload.get("brandDictionary")
    if isinstance(brand_dict, list):
        for i, row in enumerate(brand_dict):
            if not isinstance(row, dict):
                continue
            brand = str(row.get("brand") or "").strip()
            ingredients = row.get("ingredients")
            ing = ", ".join([str(x) for x in ingredients]) if isinstance(ingredients, list) else ""
            category = str(row.get("category") or "").strip()
            text = "\n".join([x for x in [f"브랜드: {brand}" if brand else "", f"카테고리: {category}" if category else "", f"성분키: {ing}" if ing else ""] if x])
            add(
                f"mk.brand.{i}",
                f"브랜드 사전: {brand or i}",
                text,
                {"kind": "brand", "brand": brand, "category": category, "index": i},
            )

    interactions = payload.get("interactions")
    if isinstance(interactions, list):
        for i, row in enumerate(interactions):
            if not isinstance(row, dict):
                continue
            title = str(row.get("title") or "상호작용")
            msg = str(row.get("message") or "").strip()
            a = str(row.get("ingredientA") or "").strip()
            b = str(row.get("ingredientB") or "").strip()
            severity = str(row.get("severity") or "").strip()
            text = "\n".join([x for x in [msg, f"성분A: {a}" if a else "", f"성분B: {b}" if b else "", f"중요도: {severity}" if severity else ""] if x])
            add(
                f"mk.interaction.{i}",
                f"상호작용: {title}",
                text,
                {"kind": "interaction", "ingredientA": a, "ingredientB": b, "severity": severity, "index": i},
            )

    # Age/profile-specific guides
    guides = payload.get("ageSpecificGuides")
    if isinstance(guides, dict):
        for key, row in guides.items():
            if not isinstance(row, dict):
                continue
            profile_key = str(key or "").strip()
            if not profile_key:
                continue
            target = str(row.get("target") or "").strip()
            recs = row.get("recommendations")
            recs_text = ", ".join([str(x).strip() for x in recs if str(x).strip()]) if isinstance(recs, list) else ""
            caution = str(row.get("caution") or "").strip()

            lines: List[str] = []
            lines.append(f"프로필키: {profile_key}")
            if target:
                lines.append(f"대상: {target}")
            if recs_text:
                lines.append(f"추천: {recs_text}")
            if caution:
                lines.append(f"주의: {caution}")

            add(
                f"mk.age.{profile_key}",
                f"프로필 가이드: {target or profile_key}",
                "\n".join([x for x in lines if x]).strip(),
                {"kind": "ageGuide", "profileKey": profile_key, "target": target},
            )

    # Extra profile-specific guides (e.g., pregnant/lactation/liver/kidney/allergy)
    p_guides = payload.get("profileSpecificGuides")
    if isinstance(p_guides, dict):
        for key, row in p_guides.items():
            if not isinstance(row, dict):
                continue
            profile_key = str(key or "").strip()
            if not profile_key:
                continue
            target = str(row.get("target") or "").strip()
            recs = row.get("recommendations")
            recs_text = ", ".join([str(x).strip() for x in recs if str(x).strip()]) if isinstance(recs, list) else ""
            caution = str(row.get("caution") or "").strip()

            lines: List[str] = []
            lines.append(f"프로필키: {profile_key}")
            if target:
                lines.append(f"대상: {target}")
            if recs_text:
                lines.append(f"추천: {recs_text}")
            if caution:
                lines.append(f"주의: {caution}")

            add(
                f"mk.profile.{profile_key}",
                f"추가 프로필 가이드: {target or profile_key}",
                "\n".join([x for x in lines if x]).strip(),
                {"kind": "profileGuide", "profileKey": profile_key, "target": target},
            )

    return docs


def _docs_from_drug_database(payload: Dict[str, Any]) -> List[RagDocument]:
    docs: List[RagDocument] = []

    drugs = payload.get("drugs")
    if not isinstance(drugs, list):
        return docs

    for i, row in enumerate(drugs):
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        aliases = row.get("aliases")
        active = row.get("activeIngredients")
        cautions = row.get("cautions")

        aliases_text = ", ".join([str(x) for x in aliases]) if isinstance(aliases, list) else ""
        active_text = ", ".join([str(x) for x in active]) if isinstance(active, list) else ""
        cautions_text = "\n".join([f"- {str(x).strip()}" for x in cautions]) if isinstance(cautions, list) else ""

        text_parts = []
        if aliases_text:
            text_parts.append(f"별칭: {aliases_text}")
        if active_text:
            text_parts.append(f"유효성분: {active_text}")
        if cautions_text:
            text_parts.append("주의사항:\n" + cautions_text)

        text = "\n".join(text_parts).strip()
        if not text:
            continue

        docs.append(
            RagDocument(
                id=f"db.drug.{i}",
                title=f"약 정보: {name or i}",
                text=text,
                meta={
                    "source": "drugDatabase.json",
                    "kind": "drug",
                    "name": name,
                    "index": i,
                },
            )
        )

    return docs


def build_default_documents() -> List[RagDocument]:
    root = _repo_root()
    mk_path = root / "frontend" / "src" / "data" / "medicalKnowledge.json"
    db_path = root / "frontend" / "src" / "data" / "drugDatabase.json"

    docs: List[RagDocument] = []

    if mk_path.exists():
        payload = _read_json(mk_path)
        if isinstance(payload, dict):
            docs.extend(_docs_from_medical_knowledge(payload))

    if db_path.exists():
        payload = _read_json(db_path)
        if isinstance(payload, dict):
            docs.extend(_docs_from_drug_database(payload))

    # Small built-in manual docs (fallback + smoke-test fixtures)
    docs.extend(
        [
            RagDocument(
                id="manual_001",
                title="이부프로펜",
                text="이부프로펜은 소염진통제로, 위장 장애를 줄이기 위해 식사 후 복용하는 것이 좋습니다.",
                meta={"source": "manual", "kind": "info"},
            ),
            RagDocument(
                id="manual_002",
                title="복합판피린",
                text="복합판피린은 감기약으로, 아세트아미노펜 성분을 포함하고 있어 타이레놀과 중복 복용을 피해야 합니다.",
                meta={"source": "manual", "kind": "safety"},
            ),
            RagDocument(
                id="manual_003",
                title="복합판피린과 타이레놀",
                text=(
                    "복합판피린은 감기약이며 타이레놀과 같은 아세트아미노펜 성분을 포함합니다. "
                    "따라서 타이레놀과 판피린을 같이 먹으면 중복 복용이 되므로 피해야 합니다."
                ),
                meta={"source": "manual", "kind": "safety"},
            ),
        ]
    )

    return docs
