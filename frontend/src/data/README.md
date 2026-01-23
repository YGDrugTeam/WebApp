# 약 데이터(Drug DB) 관리

이 프로젝트는 약 매칭/리포트 표시를 위해 `frontend/src/data/drugDatabase.json`을 사용합니다.

## 왜 자동 생성 스크립트를 쓰나요?
- 인터넷에서 임의로 내용을 긁어 붙이는 방식은 저작권/정확성 문제를 만들 수 있습니다.
- 대신 **공식 오픈데이터(API)** 를 사용해 JSON을 자동 생성하는 방식을 권장합니다.

## openFDA로 300개 약 데이터 생성(빠른 시작)
> openFDA는 미국 시장 중심이고 영문 데이터가 많습니다. 그래도 “300개 정도의 실데이터”를 빠르게 채우는 데 유용합니다.

1) 백엔드 가상환경에 패키지 설치
- `backend/requirements.txt`에 이미 `httpx`가 포함되어 있습니다.
- 설치: `pip install -r backend/requirements.txt`

2) 생성 스크립트 실행
- PowerShell 예시:
  - `C:/dev/pill-safe-ai/.venv/Scripts/python.exe backend/scripts/generate_drug_database_openfda.py --count 300 --out frontend/src/data/drugDatabase.json`

3) 프론트 재시작
- `npm start`

## 한국(식약처 등) 데이터로 확장

### MFDS(식약처) OpenAPI로 300개 생성
이 레포에는 MFDS OpenAPI에서 300개를 받아 `drugDatabase.json`으로 변환하는 스크립트가 포함되어 있습니다.

- 스크립트: `backend/scripts/generate_drug_database_mfds.py`
- 필요: `MFDS_SERVICE_KEY` (공공데이터포털에서 발급)

PowerShell 예시:
- `$env:MFDS_SERVICE_KEY="YOUR_SERVICE_KEY"`
- `C:/dev/pill-safe-ai/.venv/Scripts/python.exe backend/scripts/generate_drug_database_mfds.py --count 300 --out frontend/src/data/drugDatabase.json`

주의:
- API 키는 자동으로 "찾아드릴" 수 없습니다. 본인이 발급받아 설정해야 합니다.

## DUR CSV(특정 연령대 금기) 인코딩 문제 해결
국내 DUR CSV는 종종 `cp949`(또는 `euc-kr`) 인코딩이라 `pandas.read_csv(..., encoding='utf-8')`로 읽으면 `UnicodeDecodeError`가 납니다.

이 레포에는 인코딩/구분자를 빠르게 확인하고, UTF-8로 변환하는 스크립트를 포함합니다.

1) 인코딩/구분자 판별
- `python backend/scripts/detect_csv_encoding.py "C:/path/to/file.csv"`

2) UTF-8(BOM)로 변환(Excel 호환)
- `python backend/scripts/convert_csv_encoding.py "C:/path/to/file.csv" --in-encoding cp949`
  - 출력 파일 예: `file.csv.utf8.csv`

3) pandas로 읽기 예시
- 원본 그대로: `pd.read_csv(path, encoding='cp949', sep=',', dtype=str, keep_default_na=False)`
- 변환본 사용: `pd.read_csv(path_utf8, encoding='utf-8-sig', sep=',', dtype=str, keep_default_na=False)`

## DUR CSV → 프론트 경고 연동(연령 금기)
이 프로젝트는 `frontend/src/data/durAgeContraindications.json`을 읽어, 사용자가 입력한 연령(만 나이)에 따라 “특정 연령대 금기(DUR)” 경고를 리포트에 표시할 수 있습니다.

1) CSV를 JSON으로 변환
- 스크립트: `backend/scripts/generate_dur_age_contraindications.py`
- 예시:
  - `python backend/scripts/generate_dur_age_contraindications.py --csv "C:/path/to/DUR.csv" --out frontend/src/data/durAgeContraindications.json`

2) 앱에서 연령 입력
- 우측 리포트 상단 “사용자 정보” 카드에서 만 나이를 입력합니다.

참고(공식 데이터 탐색): 공공데이터포털에서 DUR/연령금기/병용금기 관련 파일데이터를 확인할 수 있습니다.
