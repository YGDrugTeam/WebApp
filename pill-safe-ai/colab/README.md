# Google Colab로 옮겨 실행하기

이 프로젝트는 **프론트(React)** + **백엔드(FastAPI)** 구조입니다.

- Colab은 **Python 서버/실험용**에 적합합니다. React 개발서버(`npm start`)는 Colab에서 굳이 돌리지 않는 편이 좋습니다.
- Colab에서 백엔드를 띄운 뒤, 필요하면 **ngrok/Cloudflare Tunnel**로 외부에서 접근하게 만들 수 있습니다.

## 1) 업로드(권장: ZIP 번들)

로컬에서 ZIP 만들기:

```powershell
cd D:\Dev\pill-safe-ai
.\scripts\make_colab_bundle.ps1
```

생성된 `colab_bundle.zip`을 Colab에 업로드하세요.

업로드 후 Colab에서 압축 해제:

```bash
!unzip -o colab_bundle.zip
!ls
```

> RAG는 `frontend/src/data/*.json`을 소스로 사용하므로, 번들에 해당 폴더를 포함합니다.

## 2) Colab 의존성 설치

Colab은 Linux 환경이므로 `backend/requirements.txt` 대신 `backend/requirements-colab.txt`를 권장합니다.

```bash
!pip -q install -r backend/requirements-colab.txt
```

### GPU 사용(Colab GPU 런타임일 때)

- Colab 상단에서 `런타임 → 런타임 유형 변경 → GPU`로 설정한 뒤,
- PyTorch CUDA 버전은 Colab 이미지에 따라 달라질 수 있어요.

대부분은 Colab 기본 torch로도 충분하지만, 문제가 있으면 아래처럼 재설치합니다(예: CUDA 12.x):

```bash
# 예시 (필요할 때만)
# !pip -q install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

## 3) 백엔드 실행

Colab 노트북 셀에서 uvicorn을 백그라운드로 띄우기:

```bash
!python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
```

정상 동작 확인:

```bash
!curl -s http://127.0.0.1:8000/health
!curl -s http://127.0.0.1:8000/gpu/status
```

## 4) 외부에서 접속(선택)

### A) ngrok

```bash
!pip -q install pyngrok

from pyngrok import ngrok
public_url = ngrok.connect(8000, "http")
public_url
```

이제 로컬/모바일에서 `public_url`로 접속할 수 있습니다.

### B) Cloudflare Tunnel

환경에 따라 설정이 조금 더 필요합니다(원하면 여기까지 자동화해드릴게요).

## 주의사항

- 로컬의 `.venv-gpu`(Windows) 환경은 Colab(Linux)로 그대로 옮길 수 없습니다.
- Colab에서는 **Linux용 wheel**로 다시 설치됩니다.
- MFDS/DUR 같은 외부 API는 Colab에서도 동일하게 동작하지만, 키(`backend/.env`)는 업로드하지 말고 Colab Secret/환경변수로 넣는 걸 권장합니다.
