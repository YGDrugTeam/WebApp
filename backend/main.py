from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import sqlite3
import asyncio
import time

try:
    from dur_service import DurService, DurServiceError
except Exception:  # pragma: no cover
    from .dur_service import DurService, DurServiceError

# Azure SDKs (optional: server should run without them for non-Azure features like DUR)
try:  # pragma: no cover
    import azure.cognitiveservices.speech as speechsdk
    from azure.cognitiveservices.vision.computervision import ComputerVisionClient
    from azure.cognitiveservices.vision.computervision.models import OperationStatusCodes
    from msrest.authentication import CognitiveServicesCredentials
except Exception:  # pragma: no cover
    speechsdk = None
    ComputerVisionClient = None
    OperationStatusCodes = None
    CognitiveServicesCredentials = None

app = FastAPI(title="MedicLens Backend")

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- [환경 변수 및 설정] ---
try:
    from settings import (
        AZURE_SPEECH_KEY,
        AZURE_SPEECH_ENDPOINT,
        AZURE_SPEECH_REGION,
        AZURE_VISION_ENDPOINT,
        AZURE_VISION_KEY,
        DB_PATH,
    )
except Exception:  # pragma: no cover
    from .settings import (
        AZURE_SPEECH_KEY,
        AZURE_SPEECH_ENDPOINT,
        AZURE_SPEECH_REGION,
        AZURE_VISION_ENDPOINT,
        AZURE_VISION_KEY,
        DB_PATH,
    )

# 완벽한 남/여 목소리 설정
VOICE_PRESETS = {
    "female": "ko-KR-SunHiNeural", # 맑고 신뢰감 있는 여성 음성
    "male": "ko-KR-InJoonNeural"   # 차분하고 전문적인 남성 음성
}

# --- [DB 초기화 및 관리] ---
def init_db():
    """앱 시작 시 SQLite 테이블을 초기화합니다."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        # 방법 B: 각 항목을 별도 컬럼으로 저장(INTEGER 0/1 사용)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id TEXT PRIMARY KEY,
                age INTEGER DEFAULT 30,
                gender TEXT DEFAULT 'female',
                is_pregnant INTEGER DEFAULT 0,
                has_liver_disease INTEGER DEFAULT 0,
                has_kidney_disease INTEGER DEFAULT 0,
                has_allergy INTEGER DEFAULT 0
            )
        """)
        conn.commit()

init_db()

# --- [데이터 모델(Validation)] ---
class UserProfile(BaseModel):
    user_id: str
    age: int = Field(30, ge=0, le=120)
    gender: str = "female" # female or male
    is_pregnant: bool = False
    has_liver_disease: bool = False
    has_kidney_disease: bool = False
    has_allergy: bool = False 


class DurDrug(BaseModel):
    name: str
    code: Optional[str] = None


class DurCheckRequest(BaseModel):
    drugs: List[DurDrug] = Field(default_factory=list)
    
# --- [핵심 유틸리티 함수] ---

async def get_db_profile(user_id: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM user_profiles WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
    return dict(row) if row else None

# --- [API 엔드포인트] ---

@app.post("/user/profile")
async def save_profile(profile: UserProfile):
    """사용자가 햄버거 메뉴에서 설정한 정보를 DB에 저장(UPDATE 포함)"""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.cursor()
            # 9단계: UPDATE or INSERT (SQLite의 REPLACE 문법 사용)
            cursor.execute("""
                INSERT OR REPLACE INTO user_profiles
                (user_id, age, gender, is_pregnant, has_liver_disease, has_kidney_disease, has_allergy)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                profile.user_id,
                profile.age,
                profile.gender,
                1 if profile.is_pregnant else 0,
                1 if profile.has_liver_disease else 0,
                1 if profile.has_kidney_disease else 0,
                1 if profile.has_allergy else 0
            ))
            conn.commit()
        return {"status": "ok", "message": "설정이 안전하게 저장되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.post("/analyze/ocr")
async def analyze_ocr(user_id: str, file: UploadFile = File(...)):
    """Azure Vision API를 이용한 약 봉투/처방전 텍스트 추출"""
    try:
        if not (ComputerVisionClient and CognitiveServicesCredentials):
            raise HTTPException(
                status_code=503,
                detail="Azure Vision SDK is not installed. Install azure-cognitiveservices-vision-computervision and msrest.",
            )
        if not AZURE_VISION_KEY or not AZURE_VISION_ENDPOINT:
            raise HTTPException(
                status_code=500,
                detail="Azure Vision is not configured. Set AZURE_VISION_KEY and AZURE_VISION_ENDPOINT.",
            )
        client = ComputerVisionClient(AZURE_VISION_ENDPOINT, CognitiveServicesCredentials(AZURE_VISION_KEY))
        image_data = await file.read()
        
        # 임시 파일 저장 및 처리
        temp_path = f"temp_{user_id}.jpg"
        with open(temp_path, "wb") as f:
            f.write(image_data)
            
        with open(temp_path, "rb") as f:
            read_response = client.read_in_stream(f, raw=True)
            
        operation_id = read_response.headers["Operation-Location"].split("/")[-1]
        while True:
            result = client.get_read_result(operation_id)
            if result.status not in ['notStarted', 'running']: break
            time.sleep(1)
            
        lines = [line.text for text_result in result.analyze_result.read_results for line in text_result.lines]
        os.remove(temp_path)
        return {"user_id": user_id, "detected_text": lines}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/dur/status")
async def dur_status():
    svc = DurService()
    return {
        "status": "success",
        "available": bool(svc.is_configured()),
        "configured": bool(svc.is_configured()),
    }


# Frontend default paths (when VITE_FASTAPI_BASE is empty) use the /ml prefix.
@app.get("/ml/dur/status")
async def dur_status_ml():
    return await dur_status()


@app.post("/dur/check")
async def dur_check(req: DurCheckRequest):
    svc = DurService()
    try:
        drugs = [d.name for d in (req.drugs or []) if str(d.name or "").strip()]
        hits = svc.check_pairs(drugs)
        return {
            "status": "success",
            "available": True,
            "data": [h.to_dict() for h in hits],
        }
    except DurServiceError as e:
        raise HTTPException(status_code=503, detail={"code": e.code, "message": e.public_message})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ml/dur/check")
async def dur_check_ml(req: DurCheckRequest):
    return await dur_check(req)
    
@app.post("/tts")
async def text_to_speech(user_id: str, text: str):
    """사용자 성별에 맞춰 완벽한 목소리로 음성 합성"""
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    if not speechsdk:
        raise HTTPException(
            status_code=503,
            detail="Azure Speech SDK is not installed. Install azure-cognitiveservices-speech.",
        )

    profile = await get_db_profile(user_id)
    gender = profile.get("gender", "female") if profile else "female"    
    voice_name = VOICE_PRESETS.get(gender, VOICE_PRESETS["female"])
    
    if not AZURE_SPEECH_KEY or (not AZURE_SPEECH_REGION and not AZURE_SPEECH_ENDPOINT):
        raise HTTPException(
            status_code=500,
            detail="Azure Speech is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (or AZURE_SPEECH_ENDPOINT).",
        )

    speech_config = speechsdk.SpeechConfig(
        subscription=AZURE_SPEECH_KEY,
        region=AZURE_SPEECH_REGION or None,
        endpoint=AZURE_SPEECH_ENDPOINT or None,
    )
    speech_config.speech_synthesis_voice_name = voice_name
    # Ensure we actually emit MP3 bytes when we return audio/mpeg
    try:
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
        )
    except Exception:
        pass
    
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)
    
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, lambda: synthesizer.speak_text_async(text).get())
    
    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return Response(content=result.audio_data, media_type="audio/mpeg")

    # Provide actionable diagnostics when synthesis fails.
    if result.reason == speechsdk.ResultReason.Canceled:
        try:
            details = speechsdk.SpeechSynthesisCancellationDetails(result)
            detail_text = f"TTS canceled: reason={details.reason}"
            if getattr(details, "error_details", None):
                detail_text += f" error_details={details.error_details}"
            raise HTTPException(status_code=500, detail=detail_text)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"TTS canceled (details unavailable): {e}")

    raise HTTPException(status_code=500, detail=f"TTS failed: reason={result.reason}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)