# MFDS 의약품 데이터 가져오기 (OpenAPI)

이 프로젝트는 **사이트를 크롤링하지 않고**, MFDS가 공공데이터포털(data.go.kr)에서 제공하는 **공식 OpenAPI**를 사용해서 의약품 데이터를 가져오도록 구성했습니다.

## 준비물

- Python 환경(이 repo는 `.venv` 사용)
- 서비스키: data.go.kr에서 원하는 MFDS OpenAPI를 **활용신청** 후 발급

## 설치

```bash
pip install -r backend/requirements.txt
```

## 설정

- `backend/.env.example` 참고
- 실제 키는 환경변수로 주는 것을 권장합니다.

PowerShell 예시:

```powershell
$env:MFDS_SERVICE_KEY = "여기에_서비스키"
```

### 승인받은 API 요청주소로 맞추기 (중요)

data.go.kr에서 **활용신청/승인된 API**마다 요청주소(경로)가 다릅니다.
이 프로젝트의 기본값은 `e약은요(의약품개요정보)` 계열이지만,
다른 API를 승인받았다면 반드시 `MFDS_SERVICE_PATH`를 승인된 요청주소로 바꿔야 합니다.

예: (의약품 국내 특허현황)

```powershell
$env:MFDS_SERVICE_PATH = "/1471000/DrugDmstPtntStusService/getDrugDmstPtntStusService"
```

예: (e약은요 / 의약품개요정보)

data.go.kr 화면에 서비스 루트만 보일 때가 있습니다:

`https://apis.data.go.kr/1471000/DrbEasyDrugInfoService`

이 경우엔 아래 둘 중 아무거나로 설정하면 됩니다.

```powershell
# 1) 루트만 넣어도 서버가 /getDrbEasyDrugList 를 자동으로 붙입니다.
$env:MFDS_SERVICE_PATH = "/1471000/DrbEasyDrugInfoService"

# 2) 또는 전체 메서드 경로를 명시
$env:MFDS_SERVICE_PATH = "/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList"
```

주의: 위 API는 “의약품 상세/효능/성분” 성격이 아니라 **특허현황** 데이터입니다.
앱에서 약 이름/효능 등 “의약품 정보”가 목적이면, data.go.kr에서 `DrbEasyDrugInfoService` 같은
의약품 정보 API도 별도로 **활용신청**해야 합니다.

## 실행 (300건 이상)

기본(300건):

```bash
python backend/scripts/fetch_mfds_drugs.py --limit 300 --out backend/data/mfds_drugs.json
```

500건:

```bash
python backend/scripts/fetch_mfds_drugs.py --limit 500 --out backend/data/mfds_drugs_500.json
```

### 엔드포인트 선택

스크립트는 `--preset`으로 몇 가지 대표 엔드포인트를 제공합니다. (데이터셋/버전에 따라 경로가 달라질 수 있으니 필요하면 `--service-path`로 오버라이드하세요.)

- `--preset easy`: e약은요(의약품개요정보) 계열
- `--preset permit`: 제품허가정보 계열
- `--preset pill`: 낱알식별 계열

예시:

```bash
python backend/scripts/fetch_mfds_drugs.py --preset easy --limit 300
```

### 추가 파라미터

일부 API는 검색 파라미터가 필요할 수 있습니다.

```bash
python backend/scripts/fetch_mfds_drugs.py --preset easy --param itemName=타이레놀 --limit 300
```

서버 API(`/mfds/search`, `/mfds/drugs`)도 쿼리스트링으로 추가 파라미터를 전달할 수 있습니다.

- `/mfds/search?q=...&limit=...&field=검색필드명&기타파라미터=값`
- `/mfds/drugs?limit=...&기타파라미터=값`

또는, 검색필드명을 고정하려면:

```powershell
$env:MFDS_SEARCH_PARAM = "itemName"  # 데이터셋마다 다를 수 있음
```

### 상세 필드까지(원본 포함) 가져오기

기본 응답은 UI 자동완성을 위해 `itemName/entpName/itemSeq`만 내려줍니다.
`full=1`을 주면 e약은요의 효능/용법/주의/부작용 등 **정규화된 상세 필드 + raw(원본 전체)** 를 함께 반환합니다.

예:

```bash
curl "http://localhost:8000/mfds/search?q=%ED%83%80%EC%9D%B4%EB%A0%88%EB%86%80&limit=5&full=1"
```

```bash
curl "http://localhost:8000/mfds/drugs?limit=300&full=1"
```

### (선택) DUR/병용금기 데이터

두 번째 첨부처럼 `api.odcloud.kr` + Swagger(`infuser.odcloud.kr`)로 제공되는 DUR(병용금기) 데이터는
MFDS(e약은요)와 별개의 API 스타일입니다. 필요하면 별도 연동을 추가할 수 있습니다.

현재 서버에는 DUR 연동이 포함되어 있습니다.

필요 환경변수(둘 중 하나만 있으면 됨):

- `ODCLOUD_SERVICE_KEY`: 쿼리스트링 `serviceKey=` 방식
- `ODCLOUD_AUTHORIZATION`: 헤더 `Authorization:` 방식

추가 옵션:

- `ODCLOUD_API_BASE` 기본값: `https://api.odcloud.kr/api`
- `DUR_SERVICE_PATH` 예: `/15089525/v1/uddi:3f2efdac-942b-494e-919f-8bdc583f65ea`

엔드포인트:

- `POST /dur/check`  (프론트에서 자동 호출)
- `GET /dur/search?q=...`  (디버깅/탐색용)

## 출력 형식

기본은 정규화된 형태로 저장합니다:

- `itemName`, `entpName`, `itemSeq` + `raw`(원본 전체)

원본 그대로 저장하려면:

```bash
python backend/scripts/fetch_mfds_drugs.py --raw
```

## 주의

- 호출량이 많아질 수 있으니 `--limit/--rows`를 적절히 조절하세요.
- `backend/data/`는 `.gitignore`에 포함되어 있어 다운로드 결과가 실수로 커밋되지 않습니다.
