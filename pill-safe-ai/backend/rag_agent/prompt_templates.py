from __future__ import annotations

from typing import Any, Dict


def rag_prompt_bundle() -> Dict[str, Any]:
    """Return strict prompt templates designed to reduce hallucinations.

    The backend may run in deterministic mode (no LLM) or in LLM-backed mode.
    These templates are used for the LLM-backed path and are also exposed to the UI.
    """

    output_schema = {
        "answer": "string",
        "safety_level": "ok|caution|avoid|unknown",
        "key_points": ["string"],
        "questions_needed": ["string"],
        "evidence": [
            {
                "source": "RAG|MFDS|DUR|LOCAL_DB|WEB",
                "id": "string",
                "field": "string",
                "snippet": "string",
            }
        ],
        "not_in_context": ["string"],
    }

    # Keep the instructions explicit and repetitive: this reduces "helpful" fabrication.
    strict_system = """너는 '약물 안전정보 보조' 역할을 한다.

[최우선 규칙: 환각 방지]
1) 너는 반드시 제공되는 CONTEXT/TOOLS_OUTPUT에 *명시된* 정보만 사용한다.
2) CONTEXT/TOOLS_OUTPUT에 없는 사실은 절대로 단정하지 말고, '확인 불가'로 표시한다.
3) 추론/상식/기억으로 빈칸을 채우지 않는다. 필요한 정보가 없으면 질문한다.
4) 모든 핵심 주장(금기/주의/상호작용/복용법/부작용)은 EVIDENCE에 근거(snippet)로 인용한다.
5) 근거가 부족하면 답변을 짧게 하고, '질문 목록(최대 3개)'을 제시한다.

[의료 안전]
- 진단/처방/개별 복용 지시를 하지 않는다.
- 응급 신호(호흡곤란, 전신 발진/부종, 의식저하, 심한 흉통 등)가 있으면 즉시 의료기관/응급실을 안내한다.

[출력 규칙]
- 출력은 반드시 JSON 단일 객체이며, 추가 텍스트를 출력하지 않는다.
- JSON은 아래 스키마를 따른다.
"""

    # Developer message template: how to use evidence
    strict_developer = """입력에는 다음이 주어진다:
- USER_QUESTION: 사용자의 질문
- CONTEXT: RAG로 검색된 문서 조각들(top-k)
- TOOLS_OUTPUT: MFDS/DUR(공식), LOCAL_DB(로컬 CSV), WEB(선택) 등의 요약(있을 수도, 없을 수도)

작업 지침:
A) 먼저 질문이 '특정 약'을 가정하는지 확인한다. 브랜드명만 있으면 성분/함량이 불명확하므로 질문한다.
B) CONTEXT/TOOLS_OUTPUT에서 직접 근거가 있는 주장만 요약한다.
C) 근거가 없는 부분은 not_in_context에 기록하고, 질문으로 되돌린다.
D) safety_level은 근거에 '금기/주의/중요도' 같은 명시 표현이 있을 때만 상향(avoid/caution)한다. 애매하면 unknown.

[추가 규칙: 술(알코올) 경고]
- TOOLS_OUTPUT/CONTEXT에 '음주', '술', '알코올' 관련 명시적인 금지/중대 위험(예: 간손상, 위장출혈, 호흡억제, 저혈당 쇼크 등)이 *있는 경우에만* key_points에 별도 한 줄로 경고를 넣는다.
- 근거에 없으면 술 관련 문장은 작성하지 않는다.

EVIDENCE 작성 규칙:
- evidence[i].snippet은 실제로 CONTEXT/TOOLS_OUTPUT에 존재하는 문장/필드에서 발췌한다(조합/재작성 금지).
- evidence[i].field에는 출처의 필드명 또는 문서명(예: medicalKnowledge.json, drugDatabase.json, DUR.주의 등)을 기록한다.
"""

    # User wrapper: encourage providing details; also forces the model to ask.
    strict_user = """USER_QUESTION:
{question}

CONTEXT:
{context}

TOOLS_OUTPUT:
{tools_output}

출력은 JSON만. 근거가 없으면 '확인 불가' + 질문 1~3개."""

    # Shorter variants for UI copy/paste
    compact_system = """컨텍스트 기반으로만 답해. 없으면 '확인 불가'. 모든 주장에 근거 snippet을 붙여."""
    compact_user = """질문: {question}\n컨텍스트: {context}\n도구결과: {tools_output}\nJSON만 출력."""

    return {
        "ok": True,
        "schema": output_schema,
        "templates": {
            "strict": {
                "system": strict_system,
                "developer": strict_developer,
                "user": strict_user,
            },
            "compact": {
                "system": compact_system,
                "user": compact_user,
            },
        },
        "notes": {
            "recommendations": [
                "temperature를 낮추고(예: 0~0.3) max_tokens를 제한하면 장문 환각이 줄어듭니다.",
                "Top-k 컨텍스트에 sourceId/title/field를 포함하면 근거 인용 품질이 올라갑니다.",
                "근거가 없으면 답변 생성 금지(unknown + questions_needed) 정책을 유지하세요.",
            ]
        },
    }
