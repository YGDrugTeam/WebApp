import os
from pathlib import Path
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

try:
    from dotenv import load_dotenv

    # 실행 디렉터리와 무관하게 backend/.env 를 로드
    load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")
except Exception:
    # dotenv는 선택 의존성(없어도 동작)
    pass

import numpy as np
import cv2
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
import anyio
import tempfile

app = FastAPI()


_model_module = None


def _get_model_module():
    """OCR 모듈을 요청 시점에 로드합니다.

    - `uvicorn backend.main:app` 형태로 실행해도 import가 깨지지 않도록 상대/절대 import를 모두 지원합니다.
    - EasyOCR 초기화가 무거우므로 서버 부팅 시간을 줄이기 위해 지연 로드합니다.
    """
    global _model_module
    if _model_module is None:
        try:
            from . import model as model_module
        except Exception:
            import model as model_module

        _model_module = model_module

    return _model_module

# 1. 메인 페이지 접속 시 메시지가 나오도록 수정
@app.get("/")
def read_root():
    return {
        "status": "running", 
        "message": "Pill-Safe AI Backend is active!",
        "docs_url": "/docs"  # 문서로 바로 갈 수 있는 힌트 제공
    }

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.post("/analyze")
async def analyze_pill(file: UploadFile = File(...)):    
    contents = await file.read()

    image_bytes = np.frombuffer(contents, np.uint8) 
    img = cv2.imdecode(image_bytes, cv2.IMREAD_COLOR)
    
    # model.py의 ocr_reader 함수 호출 (요청 시 지연 로드)
    model = _get_model_module()
    result = model.ocr_reader(img)

    return {
        "filename": file.filename,
        "size": len(contents),
        "message": "AI가 이미지를 확인했습니다!",
        "pill_name": result  # 실제 OCR 결과가 여기에 담깁니다.
    }


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    gender: str | None = Field(default="female", description="female|male")


class SttResponse(BaseModel):
    text: str
    provider: str = "azure-speech"


class AzureProbeResponse(BaseModel):
    ok: bool
    provider: str = "azure-speech"
    error: str | None = None
    voices_count: int | None = None


class AzureProbeRequest(BaseModel):
    key: str = Field(..., min_length=1)
    region: str | None = None
    endpoint: str | None = None


def _get_azure_speech_env():
    """Azure Speech 설정을 환경변수에서 읽습니다.

    프로젝트 기본: AZURE_SPEECH_KEY / AZURE_SPEECH_REGION
    호환(사용자 편의): AZURE_API_KEY / AZURE_REGION
    """
    key = os.getenv("AZURE_SPEECH_KEY") or os.getenv("AZURE_API_KEY")
    region = os.getenv("AZURE_SPEECH_REGION") or os.getenv("AZURE_REGION")
    endpoint = os.getenv("AZURE_SPEECH_ENDPOINT")

    # .env에 공백/개행이 섞여 들어오는 케이스를 방어
    if key:
        key = key.strip()
    if region:
        region = region.strip()
    if endpoint:
        endpoint = endpoint.strip()

    voice_male = os.getenv("AZURE_SPEECH_VOICE_MALE")
    voice_female = os.getenv("AZURE_SPEECH_VOICE_FEMALE")
    return {
        "key": key,
        "region": region,
        "endpoint": endpoint,
        "voice_male": voice_male,
        "voice_female": voice_female,
    }


@app.get("/tts/status")
def tts_status():
    """프론트에서 상태 표시/가이드를 위한 TTS 제공자 상태."""
    azure = _get_azure_speech_env()
    azure_key = azure["key"]
    azure_region = azure["region"]
    azure_endpoint = azure.get("endpoint")
    return {
        "edge_tts": {"enabled": True},
        "azure": {
            "configured": bool(azure_key and (azure_region or azure_endpoint)),
            "has_key": bool(azure_key),
            "has_region": bool(azure_region),
            "has_endpoint": bool(azure_endpoint),
            "voice_male": azure.get("voice_male") or "ko-KR-InJoonNeural",
            "voice_female": azure.get("voice_female") or "ko-KR-SunHiNeural",
            "env_hint": "Set AZURE_SPEECH_KEY + (AZURE_SPEECH_REGION or AZURE_SPEECH_ENDPOINT)"
        }
    }


def _safe_details_from_result(details_cls, result):
    """Speech SDK 버전 차이를 흡수하기 위한 헬퍼.

    일부 버전은 `*.from_result(result)`가 없고 생성자 호출을 사용합니다.
    """
    if hasattr(details_cls, "from_result"):
        return details_cls.from_result(result)
    try:
        return details_cls(result)
    except Exception:
        return None


def _azure_probe_sync(key: str, region: str | None, endpoint: str | None) -> dict:
    """Azure Speech TTS 인증/접속이 되는지 가볍게 점검합니다.

    주로 401(키/리전 불일치), 네트워크 문제 등을 빠르게 구분하기 위한 용도입니다.
    """
    import azure.cognitiveservices.speech as speechsdk

    if endpoint:
        speech_config = speechsdk.SpeechConfig(subscription=key, endpoint=endpoint)
    else:
        speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)

    try:
        voices_result = synthesizer.get_voices_async().get()
    except BaseException as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    if getattr(voices_result, "reason", None) == speechsdk.ResultReason.VoicesListRetrieved:
        voices = getattr(voices_result, "voices", None) or []
        return {"ok": True, "voices_count": len(voices)}

    if getattr(voices_result, "reason", None) == speechsdk.ResultReason.Canceled:
        # SDK 버전에 따라 details 타입/필드가 달라 최대한 정보 수집
        details_obj = None
        if hasattr(speechsdk, "VoicesListCancellationDetails"):
            details_obj = _safe_details_from_result(speechsdk.VoicesListCancellationDetails, voices_result)
        if details_obj is None:
            details_obj = _safe_details_from_result(speechsdk.CancellationDetails, voices_result)

        error_details = None
        if details_obj is not None:
            error_details = f"{getattr(details_obj, 'reason', None)} {getattr(details_obj, 'error_details', None)}"

        # 결과 객체 자체에 error_details가 있는 구현도 존재
        raw_error_details = getattr(voices_result, "error_details", None)

        msg_parts = ["Canceled"]
        if error_details and error_details.strip() != "None None":
            msg_parts.append(error_details)
        if raw_error_details:
            msg_parts.append(str(raw_error_details))

        return {"ok": False, "error": " ".join(msg_parts)}

    return {"ok": False, "error": f"Unexpected reason: {getattr(voices_result, 'reason', None)}"}


def _azure_tts_mp3_sync(text: str, voice: str, key: str, region: str) -> bytes:
    import azure.cognitiveservices.speech as speechsdk

    speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
    speech_config.speech_synthesis_voice_name = voice

    # MP3
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
    )

    pull_stream = speechsdk.audio.PullAudioOutputStream()
    audio_config = speechsdk.audio.AudioOutputConfig(stream=pull_stream)
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)

    result = synthesizer.speak_text_async(text).get()
    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        data = bytes(result.audio_data or b"")
        if data:
            return data

        # 일부 환경에서 audio_data가 비어있을 수 있어 스트림도 시도
        buf = bytearray()
        while True:
            chunk = pull_stream.read(4096)
            if not chunk:
                break
            buf.extend(chunk)
        return bytes(buf)

    if result.reason == speechsdk.ResultReason.Canceled:
        details = _safe_details_from_result(speechsdk.SpeechSynthesisCancellationDetails, result)
        if details is not None:
            raise RuntimeError(
                f"Azure TTS canceled: {getattr(details, 'reason', None)} {getattr(details, 'error_details', None)}"
            )
        raise RuntimeError("Azure TTS canceled")

    raise RuntimeError(f"Azure TTS failed: {result.reason}")


def _azure_stt_sync(wav_bytes: bytes, key: str, region: str, language: str = "ko-KR") -> str:
    import azure.cognitiveservices.speech as speechsdk

    # Azure Speech SDK는 일반적으로 WAV 파일 입력을 가장 안정적으로 처리합니다.
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as f:
        f.write(wav_bytes)
        f.flush()

        speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
        speech_config.speech_recognition_language = language

        audio_config = speechsdk.audio.AudioConfig(filename=f.name)
        recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_config)
        result = recognizer.recognize_once_async().get()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            return (result.text or "").strip()

        if result.reason == speechsdk.ResultReason.NoMatch:
            return ""

        if result.reason == speechsdk.ResultReason.Canceled:
            details = _safe_details_from_result(speechsdk.CancellationDetails, result)
            if details is not None:
                raise RuntimeError(f"Azure STT canceled: {getattr(details, 'reason', None)} {getattr(details, 'error_details', None)}")
            raise RuntimeError("Azure STT canceled")

        raise RuntimeError(f"Azure STT failed: {result.reason}")


@app.get("/stt/status")
def stt_status():
    azure = _get_azure_speech_env()
    azure_key = azure["key"]
    azure_region = azure["region"]
    return {
        "azure": {
            "configured": bool(azure_key and azure_region),
            "has_key": bool(azure_key),
            "has_region": bool(azure_region),
            "language": "ko-KR",
            "env_hint": "Set AZURE_SPEECH_KEY/AZURE_SPEECH_REGION (or AZURE_API_KEY/AZURE_REGION)"
        }
    }


@app.post("/stt", response_model=SttResponse)
async def stt(file: UploadFile = File(...)):
    """오디오(WAV 권장)를 받아 한국어 음성 인식(STT) 결과 텍스트를 반환합니다.

    보조 기능(약 이름 음성 입력)을 위한 엔드포인트입니다.
    """
    azure = _get_azure_speech_env()
    azure_key = azure.get("key")
    azure_region = azure.get("region")
    if not (azure_key and azure_region):
        return Response(
            content="STT is not configured (set AZURE_SPEECH_KEY/AZURE_SPEECH_REGION or AZURE_API_KEY/AZURE_REGION)",
            status_code=502,
            media_type="text/plain",
        )

    data = await file.read()
    if not data:
        return Response(content="empty audio", status_code=400, media_type="text/plain")

    try:
        text = await anyio.to_thread.run_sync(
            _azure_stt_sync,
            data,
            azure_key,
            azure_region,
            "ko-KR",
        )
        return {"text": text, "provider": "azure-speech"}
    except BaseException as e:
        return Response(
            content=f"STT failed: {type(e).__name__}: {e}",
            status_code=502,
            media_type="text/plain",
        )


@app.post("/tts")
async def tts(req: TtsRequest):
    """한국어 TTS 음성(MP3)을 생성합니다.

    우선순위:
    1) edge-tts
    2) Azure Speech (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION 설정된 경우)
    """
    gender = (req.gender or "female").lower().strip()
    azure = _get_azure_speech_env()

    default_voice_male = "ko-KR-InJoonNeural"
    default_voice_female = "ko-KR-SunHiNeural"
    voice_male = azure.get("voice_male") or default_voice_male
    voice_female = azure.get("voice_female") or default_voice_female
    voice = voice_female if gender != "male" else voice_male

    azure_error: str | None = None
    azure_key = azure.get("key")
    azure_region = azure.get("region")

    # 1) Azure first (핵심)
    if azure_key and azure_region:
        try:
            azure_audio = await anyio.to_thread.run_sync(
                _azure_tts_mp3_sync,
                req.text,
                voice,
                azure_key,
                azure_region,
            )
            if azure_audio:
                return Response(
                    content=azure_audio,
                    media_type="audio/mpeg",
                    headers={
                        "Content-Disposition": "inline; filename=tts.mp3",
                        "X-TTS-Provider": "azure-speech",
                    },
                )
            azure_error = "empty audio"
        except BaseException as e:
            azure_error = f"{type(e).__name__}: {e}"

    # 2) edge-tts fallback
    edge_error: str | None = None
    try:
        import edge_tts

        communicate = edge_tts.Communicate(req.text, voice=voice, rate="+0%")
        audio_bytes = bytearray()
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                audio_bytes.extend(chunk.get("data", b""))

        if audio_bytes:
            return Response(
                content=bytes(audio_bytes),
                media_type="audio/mpeg",
                headers={
                    "Content-Disposition": "inline; filename=tts.mp3",
                    "X-TTS-Provider": "edge-tts",
                },
            )
        edge_error = "edge-tts returned empty audio"
    except BaseException as e:
        edge_error = f"{type(e).__name__}: {e}"

    if azure_key and azure_region:
        return Response(
            content=f"TTS failed. azure={azure_error}; edge={edge_error}",
            status_code=502,
            media_type="text/plain",
        )

    return Response(
        content=f"TTS failed. azure=not configured (set AZURE_SPEECH_KEY/AZURE_SPEECH_REGION or AZURE_API_KEY/AZURE_REGION); edge={edge_error}",
        status_code=502,
        media_type="text/plain",
    )


@app.get("/tts/probe", response_model=AzureProbeResponse)
async def tts_probe():
    """Azure Speech TTS 인증/접속 점검용 엔드포인트."""
    azure = _get_azure_speech_env()
    azure_key = azure.get("key")
    azure_region = azure.get("region")
    azure_endpoint = azure.get("endpoint")
    if not (azure_key and (azure_region or azure_endpoint)):
        return {"ok": False, "error": "Azure TTS not configured"}

    result = await anyio.to_thread.run_sync(
        _azure_probe_sync,
        azure_key,
        azure_region,
        azure_endpoint,
    )
    return {
        "ok": bool(result.get("ok")),
        "error": result.get("error"),
        "voices_count": result.get("voices_count"),
    }


@app.post("/tts/probe_with", response_model=AzureProbeResponse)
async def tts_probe_with(req: AzureProbeRequest):
    """Azure 키/리전을 재시작 없이 시험하는 용도(저장하지 않음)."""
    key = (req.key or "").strip()
    region = (req.region or "").strip() or None
    endpoint = (req.endpoint or "").strip() or None
    if not (key and (region or endpoint)):
        return {"ok": False, "error": "Provide key and (region or endpoint)"}

    result = await anyio.to_thread.run_sync(
        _azure_probe_sync,
        key,
        region,
        endpoint,
    )
    return {
        "ok": bool(result.get("ok")),
        "error": result.get("error"),
        "voices_count": result.get("voices_count"),
    }

if __name__ == "__main__":
    import uvicorn
    import webbrowser
    import sys

    # 1. 서버 실행 주소 설정
    host = "127.0.0.1"
    port = 8000
    
    # 2. 브라우저 자동 열기 (사용자 편의)
    webbrowser.open(f"http://{host}:{port}/docs")

    # 3. 실행 위치(backend 폴더 내부인지 여부)에 따른 모듈 경로 자동 설정
    current_dir = Path(__file__).resolve().parent.name
    app_module = "main:app" if current_dir == "backend" else "backend.main:app"
    
    print(f"--- Pill-Safe AI Backend Starting ---")
    print(f"Target Module: {app_module}")
    
    uvicorn.run(app_module, host="0.0.0.0", port=port, reload=True)