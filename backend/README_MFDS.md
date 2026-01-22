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
