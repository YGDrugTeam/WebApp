# Pill-Safe AI – Copilot Instructions

이 문서는 GPT-기반 AI 코딩 에이전트가 이 레포지토리에서 바로 생산적으로 일할 수 있도록 돕기 위한 프로젝트 전용 가이드입니다.

## 전체 구조와 데이터 흐름
- **백엔드**: FastAPI 기반 OCR 서비스.
  - 엔트리포인트: [backend/main.py](backend/main.py)
  - 이미지 업로드 엔드포인트: `POST /analyze` – 멀티파트 파일 `file`을 받아 OpenCV로 디코딩 후 [backend/model.py](backend/model.py)의 `ocr_reader`로 전달합니다.
  - `ocr_reader`는 EasyOCR `Reader(['ko', 'en'])`를 모듈 로드 시 1회 생성해 재사용합니다(성능 상 중요).
- **프론트엔드**: Create React App 기반 SPA.
  - 엔트리포인트: [frontend/src/index.js](frontend/src/index.js), 루트 컴포넌트: [frontend/src/App.jsx](frontend/src/App.jsx)
  - 메인 상태: `App`에서 `drugs` 배열 상태를 관리하며, 하위 컴포넌트들이 약을 추가/삭제합니다.
- **데이터 흐름(핵심 시나리오)**:
  1. 사용자가 CameraCapture에서 사진 파일을 선택합니다.
  2. [frontend/src/components/CameraCapture.jsx](frontend/src/components/CameraCapture.jsx)가 `http://localhost:8000/analyze`로 파일을 업로드합니다.
  3. 백엔드는 OCR로 텍스트를 추출해 `pill_name` 필드로 반환합니다.
  4. CameraCapture는 `onPillDetected(pillName)`을 호출하고, `App`의 `addDrug`가 `drugs` 상태에 추가합니다.

## 개발 및 실행 워크플로
- **백엔드 개발**
  - 작업 디렉터리: `backend/`
  - 의존성: [backend/requirements.txt](backend/requirements.txt)
  - (Windows 가상환경 예시)
    - `python -m venv venv`
    - `venv\\Scripts\\activate`
    - `pip install -r requirements.txt`
  - 실행: `python main.py` → uvicorn이 `0.0.0.0:8000`에서 FastAPI 앱을 구동하며, 브라우저에서 `/docs`를 자동 오픈합니다.
- **프론트엔드 개발**
  - 작업 디렉터리: `frontend/`
  - 최초 설정: `npm install`
  - 개발 서버 실행: `npm start` (CRA 기본 설정, `localhost:3000`)

## 백엔드 구현 관례
- [backend/main.py](backend/main.py)
  - `os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'`를 설정해 OpenMP 관련 충돌을 피하고 있습니다. 같은 모듈에서 중복 설정하지 않도록 합니다.
  - CORS는 `allow_origins=["*"]`로 완전 허용 상태입니다. 프론트엔드와의 통신을 끊지 않으려면 포트/호스트를 바꿀 때 CORS 설정도 함께 고려하세요.
  - 새로운 엔드포인트를 추가할 때는 FastAPI 스타일(`@app.get`, `@app.post`)을 유지하고, 가능한 한 입력/출력 스키마를 명시적으로 정의하는 방향으로 확장합니다.
- [backend/model.py](backend/model.py)
  - `easyocr.Reader`는 모듈 전역에서 한 번만 생성해 재사용합니다. 새로운 OCR/비전 기능을 추가할 때도 이 패턴(전역 초기화 후 함수에서 사용)을 유지해 초기 로딩 비용을 최소화하세요.

## 프론트엔드 구현 관례
- **상태 구조**
  - [frontend/src/App.jsx](frontend/src/App.jsx)에서만 `drugs` 상태를 관리하고, 하위 컴포넌트에는 콜백(`onPillDetected`, `onAdd`, `onDelete`)을 내려보냅니다.
  - 새로운 약 관련 기능(예: 중복 체크 강화, 태깅 등)은 우선 `App`에 상태를 추가하고, 필요 시 전용 유틸로 로직을 분리하는 패턴을 따르세요.
- **주요 컴포넌트**
  - [frontend/src/components/CameraCapture.jsx](frontend/src/components/CameraCapture.jsx)
    - 백엔드 URL(`http://localhost:8000/analyze`)이 하드코딩되어 있습니다. 백엔드 주소/포트를 변경하면 이 파일의 URL도 반드시 함께 수정하세요.
    - 성공 시 `onPillDetected(pillName.trim())`을 호출하고, 실패/에러는 `alert`로 사용자에게 알립니다. 동일한 알림 UX를 유지하려면 새 에러 경로도 `alert` 기반으로 맞추세요.
  - [frontend/src/components/DrugInput.jsx](frontend/src/components/DrugInput.jsx)
    - 단순 텍스트 입력 + 버튼/Enter키로 약 이름을 추가합니다. 입력값 검증 로직은 여기서 최소한으로, 중복/공백 검사는 `App.addDrug`에서 처리하는 현재 구조를 유지합니다.
  - [frontend/src/components/DrugListDisplay.jsx](frontend/src/components/DrugListDisplay.jsx)
    - `drugs` 배열과 `onDelete(index)` 콜백만을 의존하는 단순 표시 컴포넌트입니다. 렌더링 관련 변경은 여기서만 처리하고, 데이터 구조 변경은 상위 컴포넌트에서 결정하도록 합니다.
  - [frontend/src/components/Header.jsx](frontend/src/components/Header.jsx)
    - 프로젝트 브랜드/타이틀만 담당합니다. 레이아웃/스타일은 [frontend/src/styles/index.css](frontend/src/styles/index.css)의 `.main-title` 클래스를 참고하세요.
- **스타일링**
  - 전역 기본 스타일: [frontend/src/index.css](frontend/src/index.css)
  - 앱 레이아웃/약 리스트 스타일: [frontend/src/styles/index.css](frontend/src/styles/index.css)
    - 두 칼럼 레이아웃(`.two-column-layout`), 제목 스타일(`.sub-title`), 약 항목(`.drug-item`)이 정의되어 있습니다.
    - 새 UI를 추가할 때는 가능한 기존 클래스 네이밍/스타일 톤(파란 포인트 컬러, 굵은 제목)을 따라주세요.

## 미완성/플레이스홀더 모듈
다음 파일들은 현재 비어 있거나 미완성 상태입니다. 사용하거나 확장하기 전에 반드시 구현을 보완해야 합니다.
- [frontend/src/components/AnalysisReport.jsx](frontend/src/components/AnalysisReport.jsx)
- [frontend/src/components/VoiceGuidePlayer.jsx](frontend/src/components/VoiceGuidePlayer.jsx)
- [frontend/src/utils/drugMatcher.js](frontend/src/utils/drugMatcher.js)
- [frontend/src/utils/interactionChecker.js](frontend/src/utils/interactionChecker.js)
- [frontend/src/utils/ocrProcessor.js](frontend/src/utils/ocrProcessor.js)
- [frontend/src/hooks/useSpeechSynthesis.js](frontend/src/hooks/useSpeechSynthesis.js)
- [frontend/src/data/drugDatabase.json](frontend/src/data/drugDatabase.json)
- [frontend/src/data/medicalKnowledge.json](frontend/src/data/medicalKnowledge.json)

이 파일들을 구현할 때는 다음 원칙을 따르는 것을 권장합니다(현재 구조와 일관성 유지):
- **비즈니스 로직**은 가능하면 `components/`가 아닌 `utils/`와 `data/`에 두고, 컴포넌트는 UI 표현과 이벤트 연결에 집중시킵니다.
- 약 정보/상호작용 관련 지식은 JSON/정적 데이터로 [frontend/src/data](frontend/src/data)에 두고, `drugMatcher`와 `interactionChecker`에서 이를 소비하는 형태로 구성합니다.

## 테스트와 품질
- [frontend/src/App.test.js](frontend/src/App.test.js)와 [frontend/src/setupTests.js](frontend/src/setupTests.js)는 CRA 기본 템플릿입니다. 아직 프로젝트 전용 테스트 패턴은 정립되지 않았습니다.
- 새 기능을 추가할 때는 최소한 수동으로 다음 흐름을 확인하세요.
  1. `npm start`로 프론트엔드, `python main.py`로 백엔드를 실행합니다.
  2. 사진 업로드 → OCR 결과가 약 목록에 자연스럽게 추가되는지 확인합니다.

---

문서에서 모호하거나 빠진 부분이 있다면 알려주세요. 특히 **약 상호작용 로직을 어디에 둘지**, **음성 안내 기능의 기대 동작** 등에 대해 더 구체적인 규칙이 필요하다면 추가로 정리하겠습니다.