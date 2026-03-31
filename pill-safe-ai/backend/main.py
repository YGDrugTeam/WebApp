import os
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Optional

BACKEND_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = BACKEND_DIR / "scripts"


def _resolve_checkpoint_path() -> Path:
    candidates = [
        SCRIPTS_DIR / "best_model.pt",
        BACKEND_DIR / "models" / "best_model.pt",
        BACKEND_DIR.parent / "checkpoints" / "pill_best.pth",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


CHECKPOINT_PATH = _resolve_checkpoint_path()

# backend 폴더를 import 루트로 고정
sys.path.insert(0, str(BACKEND_DIR))

# 로컬 모듈 임포트
from scripts.predict_convnext import predict_single_image
from pharmacy_routes import router as pharmacy_router
from info_service import PillInfoService
from pharmacy_service import PharmacyService, PharmacyServiceError
from dur_service import DurService, DurServiceError
from settings import (
    AZURE_SPEECH_ENDPOINT,
    AZURE_SPEECH_KEY,
    AZURE_SPEECH_REGION,
    AZURE_VISION_ENDPOINT,
    AZURE_VISION_KEY,
    CORS_ALLOWED_ORIGINS,
    DUR_SERVICE_PATH,
    ODCLOUD_AUTHORIZATION,
    ODCLOUD_SERVICE_KEY,
    PHARMACY_LOCAL_CSV,
    PHARMACY_SERVICE_PATH,
)

# OCR / Azure SDKs
try:
    import easyocr
except ImportError:
    easyocr = None

try:
    from PIL import Image
except ImportError:
    Image = None

try:
    import azure.cognitiveservices.speech as speechsdk
    from msrest.authentication import CognitiveServicesCredentials
except ImportError:
    speechsdk = None
    CognitiveServicesCredentials = None


_ocr_reader: Any = None
_info_service: Optional[PillInfoService] = None
_pharmacy_service: Optional[PharmacyService] = None


def get_info_service() -> PillInfoService:
    global _info_service
    if _info_service is None:
        _info_service = PillInfoService()
    return _info_service


def get_pharmacy_service() -> PharmacyService:
    global _pharmacy_service
    if _pharmacy_service is None:
        _pharmacy_service = PharmacyService()
    return _pharmacy_service


def ensure_pillow_antialias_compat() -> None:
    if Image is None or hasattr(Image, "ANTIALIAS"):
        return

    if hasattr(Image, "Resampling") and hasattr(Image.Resampling, "LANCZOS"):
        resample_value = int(Image.Resampling.LANCZOS)
    elif hasattr(Image, "LANCZOS"):
        resample_value = int(getattr(Image, "LANCZOS"))
    else:
        resample_value = 1

    setattr(Image, "ANTIALIAS", resample_value)


def get_ocr_reader():
    global _ocr_reader
    if _ocr_reader is None:
        if easyocr is None:
            raise RuntimeError("easyocr is not installed. Install it in the backend environment first.")
        ensure_pillow_antialias_compat()
        _ocr_reader = easyocr.Reader(["ko", "en"], gpu=False)
    return _ocr_reader

app = FastAPI(title="MedicLens Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(pharmacy_router)


@app.on_event("startup")
async def log_startup_diagnostics() -> None:
    route_paths = sorted(
        {
            str(getattr(route, "path", ""))
            for route in app.routes
            if getattr(route, "path", None)
        }
    )
    important_paths = [
        "/health",
        "/api/health",
        "/search",
        "/api/search",
        "/api/pharmacies/status",
        "/dur/status",
        "/api/dur/status",
        "/ml/dur/status",
        "/api/ml/dur/status",
    ]
    active_paths = [path for path in important_paths if path in route_paths]
    print(f"STARTUP_FILE: {__file__}")
    print(f"STARTUP_IMPORT_ROOT: {BACKEND_DIR}")
    print(f"STARTUP_ROUTES: {', '.join(active_paths)}")


def config_status_payload() -> dict[str, Any]:
    dur_service = DurService()
    pharmacy_service = get_pharmacy_service()
    pharmacy_available = bool(pharmacy_service.is_configured())
    dur_available = bool(dur_service.is_configured())
    local_pharmacy_data = pharmacy_service.local_data_path()

    return {
        "status": "success",
        "runtime": {
            "backend_file": str(BACKEND_DIR / "main.py"),
            "ocr_provider": "easyocr",
            "speech_provider": "azure_speech_sdk" if speechsdk is not None else "unavailable",
        },
        "keys": {
            "azureVisionKey": bool(AZURE_VISION_KEY),
            "azureVisionEndpoint": bool(AZURE_VISION_ENDPOINT),
            "azureSpeechKey": bool(AZURE_SPEECH_KEY),
            "azureSpeechRegion": bool(AZURE_SPEECH_REGION),
            "azureSpeechEndpoint": bool(AZURE_SPEECH_ENDPOINT),
            "odcloudServiceKey": bool(ODCLOUD_SERVICE_KEY),
            "odcloudAuthorization": bool(ODCLOUD_AUTHORIZATION),
        },
        "services": {
            "pharmacy": {
                "configured": pharmacy_available,
                "localCsv": local_pharmacy_data is not None,
                "localCsvPath": str(local_pharmacy_data) if local_pharmacy_data is not None else "",
                "servicePath": bool(str(PHARMACY_SERVICE_PATH or "").strip()),
            },
            "dur": {
                "configured": dur_available,
                "servicePath": bool(str(DUR_SERVICE_PATH or "").strip()),
            },
            "ocr": {
                "configured": easyocr is not None,
            },
            "pillImage": {
                "configured": CHECKPOINT_PATH.exists(),
                "checkpointPath": str(CHECKPOINT_PATH),
            },
        },
    }


def pharmacy_status_payload() -> dict[str, Any]:
    pharmacy_service = get_pharmacy_service()
    available = bool(pharmacy_service.is_configured())
    missing: list[str] = []
    local_pharmacy_data = pharmacy_service.local_data_path()

    local_csv = str(PHARMACY_LOCAL_CSV or "").strip()
    if not local_csv:
        if local_pharmacy_data is None and not str(PHARMACY_SERVICE_PATH or "").strip():
            missing.append("PHARMACY_LOCAL_CSV(or PHARMACY_SERVICE_PATH)")
        if local_pharmacy_data is None and not (str(ODCLOUD_SERVICE_KEY or "").strip() or str(ODCLOUD_AUTHORIZATION or "").strip()):
            missing.append("ODCLOUD_SERVICE_KEY(or ODCLOUD_AUTHORIZATION)")

    hint = ""
    if not available:
        hint = (
            "약국 찾기 설정이 필요해요. 기본 제공 CSV(backend/data/pharmacies_seoul_utf8.csv)가 없으면 "
            "backend/.env에 PHARMACY_LOCAL_CSV(로컬 CSV 경로) 또는 PHARMACY_SERVICE_PATH(ODCloud 데이터셋 경로)와 "
            "ODCLOUD_SERVICE_KEY(또는 ODCLOUD_AUTHORIZATION)를 설정해주세요."
        )

    return {
        "status": "success",
        "available": available,
        "configured": available,
        "localDataPath": str(local_pharmacy_data) if local_pharmacy_data is not None else "",
        "missing": missing,
        "hint": hint,
    }


def perform_pharmacy_search(payload: dict[str, Any]) -> list[dict[str, Any]]:
    pharmacy_service = get_pharmacy_service()
    q = str(payload.get("q", "") or "").strip()
    limit = int(payload.get("limit", 10))
    sort = str(payload.get("sort", "relevance") or "relevance").strip()
    lat = payload.get("lat")
    lon = payload.get("lon")
    radius_km = payload.get("radius_km")
    include_closed = bool(payload.get("include_closed", False))

    lat = float(lat) if lat not in (None, "") else None
    lon = float(lon) if lon not in (None, "") else None
    radius_km = float(radius_km) if radius_km not in (None, "") else None

    items = pharmacy_service.search(
        q=q,
        limit=limit,
        lat=lat,
        lon=lon,
        radius_km=radius_km,
        sort=sort,
        include_closed=include_closed,
    )
    return [item.to_dict() for item in items]


@app.get("/search")
@app.get("/api/search")
async def search_pill(name: Optional[str] = None):
    try:
        result = get_info_service().search_and_announce(name)
        if result:
            return {"status": "success", "data": result}
        raise HTTPException(status_code=404, detail={"status": "fail", "message": "해당하는 약 정보를 찾을 수 없습니다."})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail={"status": "error", "message": "데이터를 처리하는 중 오류가 발생했습니다."})


@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "fastapi"}


@app.get("/pharmacies/status")
@app.get("/api/pharmacies/status")
async def pharmacies_status():
    return pharmacy_status_payload()


@app.get("/config/status")
@app.get("/api/config/status")
async def config_status():
    return config_status_payload()


@app.post("/pharmacy/search")
@app.post("/api/pharmacy/search")
async def pharmacy_search_compat(request: Request):
    try:
        payload = await request.json()
        return perform_pharmacy_search(payload)
    except PharmacyServiceError as e:
        raise HTTPException(status_code=503, detail={"code": e.code, "message": e.public_message})
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "PHARMACY_BAD_REQUEST", "message": "요청 파라미터 형식이 올바르지 않아요."})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail={"message": "약국 정보를 불러오지 못했어요."})


@app.get("/dur/status")
@app.get("/api/dur/status")
@app.get("/ml/dur/status")
@app.get("/api/ml/dur/status")
async def dur_status():
    svc = DurService()
    return {
        "status": "success",
        "available": bool(svc.is_configured()),
        "configured": bool(svc.is_configured()),
    }


@app.post("/dur/check")
@app.post("/api/dur/check")
@app.post("/ml/dur/check")
@app.post("/api/ml/dur/check")
async def dur_check(request: Request):
    svc = DurService()
    try:
        payload = await request.json()
        drugs = payload.get("drugs", []) if isinstance(payload, dict) else []
        names = [str(item.get("name", "") or "").strip() for item in drugs if isinstance(item, dict)]
        names = [name for name in names if name]
        hits = svc.check_pairs(names)
        return {
            "status": "success",
            "available": True,
            "data": [hit.to_dict() for hit in hits],
        }
    except DurServiceError as e:
        raise HTTPException(status_code=503, detail={"code": e.code, "message": e.public_message})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- [API 엔드포인트: 이미지 분석] ---
@app.post("/analyze/pill-image")
@app.post("/api/analyze/pill-image")
@app.post("/ml/analyze/pill-image")
@app.post("/api/ml/analyze/pill-image")
async def analyze_pill_image(file: UploadFile = File(...)):
    try:
        # 임시 파일 저장
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_img:
            img_bytes = await file.read()
            temp_img.write(img_bytes)
            temp_img_path = Path(temp_img.name)

        # 예측 로직 (함수 내부로 통합)
        result = predict_single_image(
            image_path=temp_img_path,
            checkpoint_path=CHECKPOINT_PATH,
            device="cpu",
            top_k=5,
        )

        temp_img_path.unlink(missing_ok=True)
        return {"result": result}
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print("[예측 실패]", tb)
        raise HTTPException(status_code=500, detail=f"{str(e)}\n{tb}")


@app.post("/analyze/ocr")
@app.post("/api/analyze/ocr")
@app.post("/ml/analyze/ocr")
@app.post("/api/ml/analyze/ocr")
async def analyze_ocr(user_id: str = "demo", file: UploadFile = File(...)):
    del user_id
    temp_img_path: Optional[Path] = None
    try:
        suffix = Path(file.filename or "upload.jpg").suffix or ".jpg"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_img:
            temp_img.write(await file.read())
            temp_img_path = Path(temp_img.name)

        reader = get_ocr_reader()
        lines = [str(text).strip() for text in reader.readtext(str(temp_img_path), detail=0, paragraph=False) if str(text).strip()]
        return {"status": "success", "provider": "easyocr", "detected_text": lines}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR 분석 중 오류가 발생했습니다: {e}")
    finally:
        if temp_img_path is not None:
            temp_img_path.unlink(missing_ok=True)

# ... (이후 save_profile, analyze_ocr, tts 등 나머지 엔드포인트 작성)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)