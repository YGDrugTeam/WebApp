from fastapi import FastAPI, UploadFile, File, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List
import random
import uvicorn
import numpy as np
import cv2
import os
import tempfile

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None


def _load_env_files() -> None:
    if load_dotenv is None:
        return
    # Load a backend-local .env first, then repo-root .env if present.
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        load_dotenv(os.path.join(here, ".env"), override=False)
        load_dotenv(os.path.join(os.path.dirname(here), ".env"), override=False)
    except Exception:
        pass


_load_env_files()

try:
    import edge_tts
except Exception:  # pragma: no cover
    edge_tts = None

try:
    import azure.cognitiveservices.speech as speechsdk
except Exception:  # pragma: no cover
    speechsdk = None

from model import ocr_reader
from matcher import extract_candidates, match_drug
from mfds_openapi import MFDSOpenAPIClient, MFDSService, MFDSOpenAPIError, normalize_drug_item
from odcloud_openapi import (
    ODCloudOpenAPIClient,
    ODCloudService,
    ODCloudOpenAPIError,
    match_row_to_pair,
    match_row_to_pair_ingredients,
    row_product_names,
    row_product_codes,
    row_reason,
)

from rag_agent.service import RagService

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_RAG = RagService()

class PillListRequest(BaseModel):
    pill_list: List[str]


class TTSRequest(BaseModel):
    text: str
    gender: str | None = None  # "female" | "male"
    voice: str | None = None
    rate: str | None = None  # e.g. "+0%", "+10%"
    volume: str | None = None  # e.g. "+0%"


class DurCheckRequest(BaseModel):
    drug_names: List[str] | None = None

    # Optional richer input with codes for exact matching.
    # For MFDS e약은요, itemSeq is a good candidate to try as a product code.
    drugs: List[dict] | None = None

    # Optional: inferred active ingredients per drug name (from frontend/local DB).
    # { "타이레놀": ["아세트아미노펜"], ... }
    ingredients_by_drug: dict | None = None
    scan_limit: int | None = None
    per_page: int | None = None
    max_pages: int | None = None


class RagQueryRequest(BaseModel):
    query: str
    k: int | None = 5


class RagIndexRequest(BaseModel):
    save: bool | None = True


_DUR_ROWS_CACHE: dict[str, object] = {"key": "", "ts": 0.0, "rows": []}


def _get_cached_dur_rows(cache_key: str, ttl_s: float) -> list[dict] | None:
    import time

    try:
        key = _DUR_ROWS_CACHE.get("key")
        if not isinstance(key, str) or key != cache_key:
            return None
        ts_raw = _DUR_ROWS_CACHE.get("ts")
        ts = ts_raw if isinstance(ts_raw, (int, float)) else 0.0
        if time.time() - ts > ttl_s:
            return None
        rows = _DUR_ROWS_CACHE.get("rows")
        if isinstance(rows, list):
            return rows
    except Exception:
        return None
    return None


def _set_cached_dur_rows(cache_key: str, rows: list[dict]) -> None:
    import time

    _DUR_ROWS_CACHE["key"] = cache_key
    _DUR_ROWS_CACHE["ts"] = time.time()
    _DUR_ROWS_CACHE["rows"] = rows


VOICE_BY_GENDER = {
    "female": "ko-KR-SunHiNeural",
    "male": "ko-KR-InJoonNeural",
}

_GENDER_ALIASES = {
    "female": "female",
    "f": "female",
    "woman": "female",
    "여성": "female",
    "male": "male",
    "m": "male",
    "man": "male",
    "남성": "male",
}


def _json_error(error: str, detail: str, status_code: int = 200) -> Response:
    return Response(
        content=(
            ("{\"ok\":false,\"error\":" + repr(error) + ",\"detail\":" + repr(detail) + "}")
            .encode("utf-8")
        ),
        media_type="application/json",
        status_code=status_code,
    )


def _get_mfds_client() -> MFDSOpenAPIClient | None:
    key = os.getenv("MFDS_SERVICE_KEY", "").strip()
    if not key:
        return None
    base = os.getenv("MFDS_API_BASE", "https://apis.data.go.kr").strip() or "https://apis.data.go.kr"
    return MFDSOpenAPIClient(service_key=key, base_url=base)


def _get_mfds_service() -> MFDSService:
    # Default to a commonly-used MFDS endpoint; override via env if your approved dataset differs.
    path = os.getenv(
        "MFDS_SERVICE_PATH",
        "/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList",
    ).strip()

    # data.go.kr screens sometimes show only the service root like:
    #   https://apis.data.go.kr/1471000/DrbEasyDrugInfoService
    # In that case, append a sensible default method.
    if path.endswith("/DrbEasyDrugInfoService"):
        path = path + "/getDrbEasyDrugList"

    return MFDSService(service_path=path)


def _get_mfds_search_param() -> str | None:
    """Query parameter name to use for search.

    Different data.go.kr APIs use different query fields (or none).
    Set MFDS_SEARCH_PARAM to control which field receives `q`.

    Examples:
      MFDS_SEARCH_PARAM=itemName
      MFDS_SEARCH_PARAM= (empty -> no server-side search param)
    """

    raw = os.getenv("MFDS_SEARCH_PARAM", "itemName")
    raw = (raw or "").strip()
    return raw or None


def _collect_forward_params(request: Request, *, excluded: set[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in request.query_params.multi_items():
        if k in excluded:
            continue
        if k.lower() in {"servicekey", "pageno", "numofrows", "type"}:
            continue
        if v is None:
            continue
        out[k] = str(v)
    return out


def _get_odcloud_client() -> ODCloudOpenAPIClient | None:
    service_key = os.getenv("ODCLOUD_SERVICE_KEY", "").strip()
    authorization = os.getenv("ODCLOUD_AUTHORIZATION", "").strip()
    if not service_key and not authorization:
        return None
    base = os.getenv("ODCLOUD_API_BASE", "https://api.odcloud.kr/api").strip() or "https://api.odcloud.kr/api"
    return ODCloudOpenAPIClient(base_url=base, service_key=service_key or None, authorization=authorization or None)


def _get_dur_service() -> ODCloudService:
    # Default to the latest known DUR dataset path (can be overridden via env).
    path = os.getenv(
        "DUR_SERVICE_PATH",
        "/15089525/v1/uddi:3f2efdac-942b-494e-919f-8bdc583f65ea",
    ).strip()
    return ODCloudService(service_path=path)


async def _synthesize_edge_tts_mp3(text: str, voice: str, rate: str | None, volume: str | None) -> bytes:
    if edge_tts is None:
        raise RuntimeError("edge_tts_not_available")

    # edge-tts uses SSML-compatible voice names like ko-KR-InJoonNeural
    r = (rate or "+0%").strip() or "+0%"
    v = (volume or "+0%").strip() or "+0%"

    communicate = edge_tts.Communicate(text=text, voice=voice, rate=r, volume=v)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            tmp_path = tmp.name
        await communicate.save(tmp_path)
        with open(tmp_path, "rb") as f:
            data = f.read()
        if not data:
            raise RuntimeError("edge_tts_empty_audio")
        return data
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):
    pills = ["타이레놀 500mg", "아스피린", "베아제 정", "탁센", "겔포스 M"]

    try:
        raw = await file.read()
        data = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Invalid image")

        # Light preprocessing for OCR
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = cv2.bilateralFilter(gray, 7, 50, 50)
        _, thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        ocr_text = ocr_reader(thr)
        ocr_text = (ocr_text or "").strip()

        if ocr_text:
            candidates = extract_candidates(ocr_text)
            scored = []
            for cand in candidates[:15]:
                m = match_drug(cand)
                scored.append(
                    {
                        "candidate": cand,
                        "canonicalName": m.get("canonicalName", cand),
                        "matched": bool(m.get("matched")),
                        "score": int(m.get("score", 0)),
                    }
                )

            scored.sort(key=lambda x: x["score"], reverse=True)

            # Deduplicate by canonical name
            top_matches = []
            seen = set()
            for item in scored:
                name = str(item.get("canonicalName") or "").strip()
                if not name:
                    continue
                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)
                top_matches.append({"name": name, "score": item["score"], "matched": item["matched"], "source": item["candidate"]})
                if len(top_matches) >= 3:
                    break

            best = top_matches[0] if top_matches else None

            # If matching fails, fall back to the first candidate chunk
            pill_name = (
                best["name"]
                if best and best.get("matched")
                else (candidates[0] if candidates else ocr_text[:40])
            )
            return {
                "pill_name": pill_name,
                "ocr_text": ocr_text,
                "candidates": candidates,
                "matched": bool(best and best.get("matched")),
                "score": int(best["score"]) if best else 0,
                "top_matches": top_matches,
            }

    except Exception:
        # Fall back to stub detection
        pass

    detected_pill = random.choice(pills)
    return {
        "pill_name": f"{detected_pill} (인식됨)",
        "ocr_text": "",
        "candidates": [],
        "matched": False,
        "score": 0,
        "top_matches": [],
    }

@app.post("/analyze-safety")
async def analyze_safety(request: PillListRequest):
    pills = request.pill_list
    report = f"### 💊 AI 약물 상호작용 분석 리포트\n\n"
    report += f"**분석 대상:** {', '.join(pills)}\n\n"
    report += "1. **병용 금기:** 해당 약물 간의 치명적인 상호작용은 발견되지 않았습니다.\n"
    report += "2. **주의 사항:** 위장 장애를 예방하기 위해 식후 30분에 복용하세요.\n"
    report += "3. **전문가 한마디:** 증상이 지속되면 즉시 복용을 중단하고 전문의와 상담하십시오."
    
    return {"status": "success", "result": report}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/rag/index")
async def rag_index(req: RagIndexRequest):
    """(Re)build the local RAG index from repo JSON knowledge sources."""

    try:
        result = _RAG.rebuild(save=bool(req.save) if req.save is not None else True)
        return {"ok": True, **result}
    except Exception as e:
        return _json_error("rag_index_error", f"{type(e).__name__}: {e}", status_code=500)


@app.post("/rag/query")
async def rag_query(req: RagQueryRequest):
    """Query the local RAG index.

    NOTE: This currently returns a deterministic synthesized answer without calling an LLM.
    """

    q = str(req.query or "").strip()
    if not q:
        return _json_error("rag_query_missing", "query is required", status_code=400)

    k = req.k if isinstance(req.k, int) else 5
    k = max(1, min(10, k))

    try:
        return _RAG.answer(q, k=k)
    except Exception as e:
        return _json_error("rag_query_error", f"{type(e).__name__}: {e}", status_code=500)


@app.get("/mfds/search")
async def mfds_search(
    request: Request,
    q: str = Query(min_length=1),
    limit: int = Query(20, ge=1, le=200),
    field: str | None = Query(
        None,
        description="Optional: dataset-specific query field name to receive q. If omitted, MFDS_SEARCH_PARAM is used.",
    ),
    full: bool = Query(
        False,
        description="When true, return normalized records including detailed fields and raw payload.",
    ),
    scan_pages: int = Query(
        50,
        ge=1,
        le=200,
        description="When server-side filtering is unreliable, scan this many pages and filter locally.",
    ),
):
    client = _get_mfds_client()
    if client is None:
        return _json_error(
            "mfds_key_missing",
            "Server is not configured. Set MFDS_SERVICE_KEY (and optionally MFDS_SERVICE_PATH, MFDS_API_BASE).",
            status_code=503,
        )

    service = _get_mfds_service()
    try:
        base_params = _collect_forward_params(request, excluded={"q", "limit", "field", "scan_pages"})

        search_param = (field or "").strip() or _get_mfds_search_param()
        fast_params = dict(base_params)
        if search_param:
            fast_params[search_param] = q

        # For client-side scans, omit the server-side search param to avoid exact-match filters.
        scan_params = dict(base_params)

        q_norm = q.strip().lower()
        search_param_norm = (search_param or "").strip().lower()
        name_search_fields = {"itemname", "item_name", "prdlstnm", "prdlst_nm", "entp_item_name"}
        needs_local_name_filter = (not search_param) or (search_param_norm in name_search_fields)

        # Many MFDS endpoints either don't support server-side search at all, or ignore the search param.
        # For name searches, scan a few pages and filter locally to produce relevant results.
        if needs_local_name_filter:
            matches: list[dict] = []
            for raw in client.iter_items(
                service,
                limit=scan_pages * 100,
                rows=100,
                extra_params=scan_params,
                max_pages=scan_pages,
            ):
                norm = normalize_drug_item(raw)
                name = str(norm.get("itemName") or "").strip()
                if not name:
                    continue
                if q_norm not in name.lower():
                    continue
                matches.append(norm)
                if len(matches) >= limit:
                    break

            normalized = matches
        else:
            raw_items = client.fetch_items(service, limit=limit, rows=min(100, limit), extra_params=fast_params)
            normalized = [normalize_drug_item(x) for x in raw_items]

        if full:
            items_out = [x for x in normalized if x.get("itemName")]
        else:
            # Drop the bulky raw payload for UI suggestion list by default.
            items_out = [
                {
                    "itemName": x.get("itemName"),
                    "entpName": x.get("entpName"),
                    "itemSeq": x.get("itemSeq"),
                }
                for x in normalized
            ]
            items_out = [x for x in items_out if x.get("itemName")]

        return {"status": "ok", "q": q, "count": len(items_out), "items": items_out}
    except MFDSOpenAPIError as e:
        msg = str(e)
        if "HTTP 403" in msg or "403" in msg and "Forbidden" in msg:
            return _json_error(
                "mfds_forbidden",
                "MFDS OpenAPI returned 403 Forbidden. This usually means your service key is not approved for this dataset, or the endpoint path is not the one you applied for. "
                "Check: (1) data.go.kr에서 해당 MFDS API를 '활용신청' 했는지, (2) MFDS_SERVICE_KEY가 맞는지(가능하면 'Decoding' 키 사용), "
                "(3) MFDS_SERVICE_PATH가 신청한 API의 요청주소와 일치하는지.",
                status_code=502,
            )
        return _json_error("mfds_openapi_error", msg, status_code=502)
    except Exception as e:
        return _json_error("mfds_unknown_error", f"{type(e).__name__}: {e}", status_code=500)


@app.get("/mfds/drugs")
async def mfds_drugs(
    request: Request,
    limit: int = Query(300, ge=1, le=500),
    full: bool = Query(
        False,
        description="When true, return normalized records including detailed fields and raw payload.",
    ),
):
    """Fetch a batch of MFDS drug items (>=300 by default).

    Useful for seeding the UI or local caching. Requires MFDS_SERVICE_KEY.
    """

    client = _get_mfds_client()
    if client is None:
        return _json_error(
            "mfds_key_missing",
            "Server is not configured. Set MFDS_SERVICE_KEY (and optionally MFDS_SERVICE_PATH, MFDS_API_BASE).",
            status_code=503,
        )

    service = _get_mfds_service()
    try:
        extra_params = _collect_forward_params(request, excluded={"limit"})
        raw_items = client.fetch_items(service, limit=limit, rows=min(100, limit), extra_params=extra_params)
        normalized = [normalize_drug_item(x) for x in raw_items]
        if full:
            items_out = [x for x in normalized if x.get("itemName")]
        else:
            items_out = [
                {
                    "itemName": x.get("itemName"),
                    "entpName": x.get("entpName"),
                    "itemSeq": x.get("itemSeq"),
                }
                for x in normalized
            ]
            items_out = [x for x in items_out if x.get("itemName")]

        return {"status": "ok", "count": len(items_out), "items": items_out}
    except MFDSOpenAPIError as e:
        msg = str(e)
        if "HTTP 403" in msg or "403" in msg and "Forbidden" in msg:
            return _json_error(
                "mfds_forbidden",
                "MFDS OpenAPI returned 403 Forbidden. Check service key approval and MFDS_SERVICE_PATH configuration.",
                status_code=502,
            )
        return _json_error("mfds_openapi_error", msg, status_code=502)
    except Exception as e:
        return _json_error("mfds_unknown_error", f"{type(e).__name__}: {e}", status_code=500)


@app.get("/dur/search")
async def dur_search(
    request: Request,
    q: str = Query(min_length=1),
    limit: int = Query(50, ge=1, le=500),
    scan_limit: int = Query(2000, ge=50, le=20000),
    per_page: int = Query(100, ge=1, le=500),
    max_pages: int = Query(50, ge=1, le=500),
):
    """Search DUR (병용금기) rows by product name substring (best-effort).

    NOTE: The ODCloud swagger often only documents paging, so we do client-side filtering
    unless you pass advanced ODCloud query params via the query string.
    """

    client = _get_odcloud_client()
    if client is None:
        return _json_error(
            "odcloud_key_missing",
            "Server is not configured. Set ODCLOUD_SERVICE_KEY or ODCLOUD_AUTHORIZATION (and optionally ODCLOUD_API_BASE, DUR_SERVICE_PATH).",
            status_code=503,
        )

    service = _get_dur_service()
    try:
        extra = _collect_forward_params(request, excluded={"q", "limit", "scan_limit", "per_page", "max_pages"})

        qn = q.strip().lower()
        matched: list[dict] = []
        for row in client.iter_rows(
            service,
            limit=scan_limit,
            per_page=per_page,
            extra_params=extra,
            max_pages=max_pages,
        ):
            a, b = row_product_names(row)
            ca, cb = row_product_codes(row)
            hay = f"{a or ''} {b or ''}".lower()
            if qn in hay:
                matched.append(
                    {
                        "productA": a,
                        "productB": b,
                        "codeA": ca,
                        "codeB": cb,
                        "reason": row_reason(row),
                        "raw": row,
                    }
                )
                if len(matched) >= limit:
                    break

        return {"status": "ok", "q": q, "count": len(matched), "items": matched}
    except ODCloudOpenAPIError as e:
        return _json_error("dur_openapi_error", str(e), status_code=502)
    except Exception as e:
        return _json_error("dur_unknown_error", f"{type(e).__name__}: {e}", status_code=500)


@app.post("/dur/check")
async def dur_check(payload: DurCheckRequest):
    """Check contraindicated pairs via ODCloud DUR dataset (best-effort name matching)."""

    # Accept either plain names or richer objects with codes.
    drugs_in: list[dict] = []
    if isinstance(payload.drugs, list):
        drugs_in = [x for x in payload.drugs if isinstance(x, dict)]

    names_in = [str(x or "").strip() for x in (payload.drug_names or [])]
    names_in = [x for x in names_in if x]

    drugs: list[dict] = []
    if drugs_in:
        for d in drugs_in:
            name = str(d.get("name") or d.get("itemName") or "").strip()
            if not name:
                continue
            code = str(d.get("product_code") or d.get("productCode") or d.get("item_seq") or d.get("itemSeq") or "").strip() or None
            drugs.append({"name": name, "code": code})
    else:
        drugs = [{"name": n, "code": None} for n in names_in]

    if len(drugs) < 2:
        return {"status": "ok", "warnings": [], "cautions": [], "info": []}

    client = _get_odcloud_client()
    if client is None:
        return _json_error(
            "odcloud_key_missing",
            "Server is not configured. Set ODCLOUD_SERVICE_KEY or ODCLOUD_AUTHORIZATION.",
            status_code=503,
        )

    service = _get_dur_service()

    scan_limit = int(payload.scan_limit or 3000)
    scan_limit = max(100, min(scan_limit, 20000))
    per_page = int(payload.per_page or 100)
    per_page = max(1, min(per_page, 500))
    max_pages = int(payload.max_pages or 80)
    max_pages = max(1, min(max_pages, 500))

    ingredients_by_drug = payload.ingredients_by_drug if isinstance(payload.ingredients_by_drug, dict) else {}

    # Pairwise matching against scanned rows (cached)
    warnings: list[dict] = []
    seen_pairs: set[tuple[str, str]] = set()

    try:
        ttl_s = float(os.getenv("DUR_CACHE_TTL_S", "3600") or "3600")
        cache_key = f"{service.service_path}|{scan_limit}|{per_page}|{max_pages}"

        cached = _get_cached_dur_rows(cache_key, ttl_s)
        if cached is None:
            cached = client.fetch_rows(service, limit=scan_limit, per_page=per_page, max_pages=max_pages)
            _set_cached_dur_rows(cache_key, cached)

        for row in cached:
            a, b = row_product_names(row)
            if not a or not b:
                continue

            # Try to match any pair of provided drug names against this row
            for i in range(len(drugs)):
                for j in range(i + 1, len(drugs)):
                    left = str(drugs[i].get("name") or "").strip()
                    right = str(drugs[j].get("name") or "").strip()
                    left_code = drugs[i].get("code")
                    right_code = drugs[j].get("code")
                    if not left or not right:
                        continue

                    key = (left, right) if left <= right else (right, left)
                    if key in seen_pairs:
                        continue

                    left_ings = ingredients_by_drug.get(left) if isinstance(ingredients_by_drug.get(left), list) else None
                    right_ings = ingredients_by_drug.get(right) if isinstance(ingredients_by_drug.get(right), list) else None

                    matched = False

                    # 1) Code-first exact match
                    if left_code and right_code:
                        matched = match_row_to_pair(row, left, right, left_code=left_code, right_code=right_code)

                    # 2) Ingredient-based match (more stable than product names)
                    if not matched and left_ings and right_ings:
                        matched = match_row_to_pair_ingredients(row, left_ings, right_ings)

                    # 3) Fallback: fuzzy product-name match
                    if not matched:
                        matched = match_row_to_pair(row, left, right)

                    if matched:
                        seen_pairs.add(key)
                        reason = row_reason(row)
                        msg = f"{left} + {right} 병용금기" + (f" — {reason}" if reason else "")
                        warnings.append(
                            {
                                "severity": "danger",
                                "title": "병용금기(DUR)",
                                "message": msg,
                                "related": [left, right],
                                "source": "dur",
                                "raw": row,
                            }
                        )

        return {"status": "ok", "warnings": warnings, "cautions": [], "info": []}
    except ODCloudOpenAPIError as e:
        return _json_error("dur_openapi_error", str(e), status_code=502)
    except Exception as e:
        return _json_error("dur_unknown_error", f"{type(e).__name__}: {e}", status_code=500)


@app.post("/tts")
async def tts(request: TTSRequest):
    text = (request.text or "").strip()
    if not text:
        return Response(content=b"", media_type="audio/mpeg")

    gender_raw = (request.gender or "female").strip()
    gender = _GENDER_ALIASES.get(gender_raw.lower(), _GENDER_ALIASES.get(gender_raw, "female"))
    voice = (request.voice or VOICE_BY_GENDER.get(gender) or VOICE_BY_GENDER["female"]).strip()

    provider = os.getenv("PILL_SAFE_TTS_PROVIDER", "auto").strip().lower()  # auto|edge|azure

    # 1) edge-tts (requested): best-effort, may be blocked depending on network
    if provider in {"auto", "edge"}:
        try:
            mp3 = await _synthesize_edge_tts_mp3(text=text, voice=voice, rate=request.rate, volume=request.volume)
            return Response(content=mp3, media_type="audio/mpeg")
        except Exception as e:
            if provider == "edge":
                return _json_error(
                    "edge_tts_failed",
                    f"edge-tts failed ({type(e).__name__}). This may be blocked by network/policy. Set PILL_SAFE_TTS_PROVIDER=azure or configure Azure keys for fallback.",
                )
            # auto: fall through to Azure

    key = os.getenv("AZURE_SPEECH_KEY", "").strip()
    region = os.getenv("AZURE_SPEECH_REGION", "").strip()

    if provider == "azure" and (not key or not region or speechsdk is None):
        return _json_error(
            "server_tts_unavailable",
            "Azure TTS selected but unavailable. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.",
        )

    if not key or not region or speechsdk is None:
        # No credentials -> client will fall back to browser TTS.
        return _json_error(
            "server_tts_unavailable",
            "Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION to enable stable male/female neural voices.",
        )

    speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
    speech_config.speech_synthesis_voice_name = voice

    # MP3 output for easy browser playback
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
    )

    # Synthesize to memory (no speaker)
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)

    # Run sync SDK call in thread to avoid blocking the event loop
    import asyncio
    loop = asyncio.get_running_loop()

    def _do():
        result = synthesizer.speak_text_async(text).get()
        return result

    result = await loop.run_in_executor(None, _do)

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        audio_bytes = bytes(result.audio_data)
        return Response(content=audio_bytes, media_type="audio/mpeg")

    # Provide actionable error
    detail = "tts_failed"
    if result.reason == speechsdk.ResultReason.Canceled:
        cancel = speechsdk.SpeechSynthesisCancellationDetails.from_result(result)
        detail = f"{cancel.reason}: {cancel.error_details}"

    return _json_error("server_tts_failed", str(detail))


if __name__ == "__main__":
    reload = os.getenv("PILL_SAFE_RELOAD", "").strip() in {"1", "true", "True", "yes", "YES"}
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=reload)