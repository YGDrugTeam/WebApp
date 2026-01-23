# Backend (FastAPI)

## 실행

권장(루트에서 실행):

```powershell
cd C:\dev\pill-safe-ai
C:/dev/pill-safe-ai/.venv/Scripts/python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

대안(backend 폴더에서 직접 실행):

```powershell
cd C:\dev\pill-safe-ai\backend
C:/dev/pill-safe-ai/.venv/Scripts/python.exe .\main.py
```

접속:
- 문서: http://localhost:8000/docs

## 환경변수 (.env)

`backend/.env`에 아래를 설정하면 Azure TTS/STT가 활성화됩니다.

- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION` (예: `koreacentral`)

호환 별칭도 지원합니다:
- `AZURE_API_KEY`
- `AZURE_REGION`

예시는 `backend/.env.example` 참고.

## 빠른 점검

상태 확인:
- `GET /tts/status`
- `GET /stt/status`

샘플 호출 스크립트:

```powershell
cd C:\dev\pill-safe-ai
powershell -ExecutionPolicy Bypass -File .\backend\scripts\check_voice_endpoints.ps1
```

## 트러블슈팅

- `/tts`가 `Authentication error (401)`로 실패하면 `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` 조합이 잘못됐을 가능성이 큽니다.
	- Azure Portal에서 **Speech** 리소스의 Key(키1/키2)와 Region을 다시 확인해 `backend/.env`에 반영한 뒤 백엔드를 재시작하세요.

## 주의
- OCR(EasyOCR)은 초기화가 무거워서 `/analyze` 호출 시점에 로드되도록 되어 있습니다.
- `backend/.env`에는 비밀키가 들어갈 수 있으니 Git에 커밋되지 않도록 관리하세요(루트 `.gitignore`에 포함됨).
