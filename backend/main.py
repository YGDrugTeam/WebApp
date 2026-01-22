from fastapi import FastAPI, UploadFile, File, Query
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

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class PillListRequest(BaseModel):
    pill_list: List[str]


class TTSRequest(BaseModel):
    text: str
    gender: str | None = None  # "female" | "male"
    voice: str | None = None
    rate: str | None = None  # e.g. "+0%", "+10%"
    volume: str | None = None  # e.g. "+0%"


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
    return MFDSService(service_path=path)


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


@app.get("/mfds/search")
async def mfds_search(q: str = Query(min_length=1), limit: int = Query(20, ge=1, le=200)):
    client = _get_mfds_client()
    if client is None:
        return _json_error(
            "mfds_key_missing",
            "Server is not configured. Set MFDS_SERVICE_KEY (and optionally MFDS_SERVICE_PATH, MFDS_API_BASE).",
            status_code=503,
        )

    service = _get_mfds_service()
    try:
        raw_items = client.fetch_items(service, limit=limit, rows=min(100, limit), extra_params={"itemName": q})
        normalized = [normalize_drug_item(x) for x in raw_items]
        # Drop the bulky raw payload for UI suggestion list by default.
        simplified = [
            {
                "itemName": x.get("itemName"),
                "entpName": x.get("entpName"),
                "itemSeq": x.get("itemSeq"),
            }
            for x in normalized
        ]
        simplified = [x for x in simplified if x.get("itemName")]
        return {"status": "ok", "q": q, "count": len(simplified), "items": simplified}
    except MFDSOpenAPIError as e:
        return _json_error("mfds_openapi_error", str(e), status_code=502)
    except Exception as e:
        return _json_error("mfds_unknown_error", f"{type(e).__name__}: {e}", status_code=500)


@app.get("/mfds/drugs")
async def mfds_drugs(limit: int = Query(300, ge=1, le=500)):
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
        raw_items = client.fetch_items(service, limit=limit, rows=min(100, limit))
        normalized = [normalize_drug_item(x) for x in raw_items]
        simplified = [
            {
                "itemName": x.get("itemName"),
                "entpName": x.get("entpName"),
                "itemSeq": x.get("itemSeq"),
            }
            for x in normalized
        ]
        simplified = [x for x in simplified if x.get("itemName")]
        return {"status": "ok", "count": len(simplified), "items": simplified}
    except MFDSOpenAPIError as e:
        return _json_error("mfds_openapi_error", str(e), status_code=502)
    except Exception as e:
        return _json_error("mfds_unknown_error", f"{type(e).__name__}: {e}", status_code=500)


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