from __future__ import annotations
import os

import math
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import csv
from pathlib import Path

def get_lat(row: Dict[str, Any]) -> Optional[float]:
    lat, _ = _extract_lat_lon(row)
    return lat

def get_lon(row: Dict[str, Any]) -> Optional[float]:
    _, lon = _extract_lat_lon(row)
    return lon

# Optional coordinate conversion
try:  # pragma: no cover
    from pyproj import CRS, Transformer
except Exception:  # pragma: no cover
    CRS = None
    Transformer = None
if CRS is not None:
    try:
        print('DEBUG CRS:', CRS.to_string())
    except Exception:
        print('DEBUG CRS:', CRS)
else:
    print('DEBUG CRS:', CRS)
if Transformer is not None:
    try:
        print('DEBUG Transformer:', Transformer.description)
    except Exception:
        print('DEBUG Transformer:', Transformer)
else:
    print('DEBUG Transformer:', Transformer)

try:
    # When running as scripts from backend/ directory
    from odcloud_openapi import (
        ODCloudOpenAPIClient,
        ODCloudOpenAPIError,
        ODCloudService,
        normalize_text,
        score_match,
    )
    from settings import (
        ODCLOUD_API_BASE,
        ODCLOUD_AUTHORIZATION,
        ODCLOUD_SERVICE_KEY,
        PHARMACY_SERVICE_PATH,
        PHARMACY_LOCAL_CSV,
    )
except Exception:  # pragma: no cover
    # When imported as a package (e.g., from backend.pharmacy_service)
    from .odcloud_openapi import (
        ODCloudOpenAPIClient,
        ODCloudOpenAPIError,
        ODCloudService,
        normalize_text,
        score_match,
    )
    from .settings import (
        ODCLOUD_API_BASE,
        ODCLOUD_AUTHORIZATION,
        ODCLOUD_SERVICE_KEY,
        PHARMACY_SERVICE_PATH,
        PHARMACY_LOCAL_CSV,
    )


class PharmacyServiceError(RuntimeError):
    def __init__(self, message: str, *, code: str = "PHARMACY_ERROR", public_message: Optional[str] = None) -> None:
        super().__init__(message)
        self.code = code
        self.public_message = public_message or "약국 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요."


@dataclass
class PharmacyItem:
    name: str
    address: str
    phone: str
    distance_km: Optional[float]
    lat: Optional[float]
    lon: Optional[float]
    raw: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "address": self.address,
            "phone": self.phone,
            "distance_km": self.distance_km,
            "lat": self.lat,
            "lon": self.lon,
            "raw": self.raw,
            "kakao_map_url": self.get_kakao_map_url(),
            "kakao_roadview_url": self.get_kakao_roadview_url(),
        }
    
    def get_kakao_map_url(self) -> str:
        """카카오맵 URL 생성 (지도 보기)"""
        if self.lat is not None and self.lon is not None:
            return f"https://map.kakao.com/link/map/{self.name},{self.lat},{self.lon}"
        return ""
    
    def get_kakao_roadview_url(self) -> str:
        """카카오맵 로드뷰 URL 생성 (스트리트뷰)"""
        if self.lat is not None and self.lon is not None:
            return f"https://map.kakao.com/link/roadview/{self.lat},{self.lon}"
        return ""


def _pick_first(row: Dict[str, Any], keys: List[str]) -> str:
    for k in keys:
        v = row.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""

# float 변환 유틸
def _to_float(val) -> Optional[float]:
    try:
        if val is None or val == "":
            return None
        return float(val)
    except Exception:
        return None

# haversine 거리 계산 (단위: km)
def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0  # 지구 반지름 (km)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def _extract_lat_lon(row: Dict[str, Any]) -> tuple[Optional[float], Optional[float]]:
    lat = _to_float(
        row.get("위도")
        or row.get("LAT")
        or row.get("lat")
        or row.get("Latitude")
        or row.get("latitude")
        or row.get("Y")
        or row.get("y")
        or row.get("좌표정보(Y)")
        or row.get("좌표 정보(Y)")
    )
    lon = _to_float(
        row.get("경도")
        or row.get("LON")
        or row.get("lon")
        or row.get("Longitude")
        or row.get("longitude")
        or row.get("X")
        or row.get("x")
        or row.get("좌표 정보(X)")
        or row.get("좌표정보(X)")
    )

    # If already WGS84-ish, return.
    if lat is not None and lon is not None and 30.0 <= lat <= 45.0 and 120.0 <= lon <= 135.0:
        return (lat, lon)

    # CSV from 공공데이터 often uses Korean TM coordinates under X/Y columns.
    # Convert best-effort if pyproj is available.
    x = _to_float(row.get("좌표 정보(X)") or row.get("좌표정보(X)") or row.get("X") or row.get("x"))
    y = _to_float(row.get("좌표정보(Y)") or row.get("좌표 정보(Y)") or row.get("Y") or row.get("y"))

    if x is None or y is None:
        if lat is None or lon is None:
            print(f"[LATLON-DEBUG] 좌표 추출 실패: row={row}")
        return (lat, lon)

    # If values look like degrees (already lon/lat), handle that too.
    if 120.0 <= x <= 135.0 and 30.0 <= y <= 45.0:
        return (y, x)

    if Transformer is None:
        # Don't return projected coordinates as lat/lon.
        if lat is None or lon is None:
            print(f"[LATLON-DEBUG] pyproj 변환 불가, 좌표 없음: row={row}")
        return (lat, lon) if (lat and lon and abs(lat) <= 90 and abs(lon) <= 180) else (None, None)

    # Heuristic: try common Korean projected CRSs and pick the first plausible result.
    # (기관별로 좌표계가 다를 수 있어 자동 추정)
    candidates = [5174, 2097, 5181, 5178, 5179, 5180, 5186, 2096, 2098, 2099]
    for epsg in candidates:
        try:
            transformer = Transformer.from_crs(CRS.from_epsg(epsg), CRS.from_epsg(4326), always_xy=True)
            lon2, lat2 = transformer.transform(x, y)
            if lat2 is not None and lon2 is not None:
                if 30.0 <= float(lat2) <= 45.0 and 120.0 <= float(lon2) <= 135.0:
                    return (float(lat2), float(lon2))

            # Some datasets swap axis order; try best-effort.
            lon3, lat3 = transformer.transform(y, x)
            if lat3 is not None and lon3 is not None:
                if 30.0 <= float(lat3) <= 45.0 and 120.0 <= float(lon3) <= 135.0:
                    return (float(lat3), float(lon3))
        except Exception:
            continue

    # If we couldn't convert, do not leak projected coordinates.
    print(f"[LATLON-DEBUG] 좌표 변환 실패: row={row}")
    return (lat, lon) if (lat and lon and abs(lat) <= 90 and abs(lon) <= 180) else (None, None)



class PharmacyService:
    def _local_xlsx_path(self) -> str:
        """
        PHARMACY_LOCAL_XLSX 환경변수가 있으면 그 경로를 우선 사용하고,
        없으면 backend/data/pharmacies_seoul_utf8_business_only_cleaned.xlsx를 반환합니다.
        경로는 항상 프로젝트 루트 기준으로 절대경로로 변환합니다.
        """
        try:
            from settings import PHARMACY_LOCAL_XLSX
        except ImportError:
            PHARMACY_LOCAL_XLSX = None
        from pathlib import Path
        backend_dir = Path(__file__).resolve().parent
        project_root = backend_dir.parent
        if PHARMACY_LOCAL_XLSX:
            p = Path(PHARMACY_LOCAL_XLSX)
            if not p.is_absolute():
                p = project_root / p
            return str(p.resolve())
        return str((project_root / "backend" / "data" / "pharmacies_seoul_utf8_filled_no_missing.xlsx").resolve())

    def _fetch_rows_cached(self, *, limit: int = 3000, per_page: int = 200) -> List[Dict[str, Any]]:
        # 캐시 완전 무시: 항상 새로 읽음
        xlsx_path = self._local_xlsx_path()
        rows: List[Dict[str, Any]] = []
        import os
        print(f"[XLSX-DEBUG] Trying to open XLSX at: {xlsx_path}")
        if not os.path.exists(xlsx_path):
            print(f"[XLSX-DEBUG] XLSX file does NOT exist at: {xlsx_path}")
        else:
            print(f"[XLSX-DEBUG] XLSX file exists at: {xlsx_path}")
        try:
            import pandas as pd
            df = pd.read_excel(xlsx_path)
            # 컬럼명 앞뒤 공백 및 BOM 제거
            df.columns = [str(col).replace('\ufeff', '').strip() for col in df.columns]
            # 컬럼명 매핑(예: '사업장명' → '사업장명', '도로명주소' → '도로명주소')
            # 필요시 여기에 추가 매핑 가능
            for i, row in enumerate(df.to_dict(orient='records')):
                if i < 3:
                    print(f"[XLSX-DEBUG] row {i} keys: {list(row.keys())}")
                    print(f"[XLSX-DEBUG] row {i} values: {list(row.values())}")
                if i >= limit:
                    break
                # row의 키도 공백/BOM 제거
                clean_row = {str(k).replace('\ufeff', '').strip(): v for k, v in row.items()}
                rows.append(clean_row)
        except Exception as e:
            import logging
            logging.error(f'PharmacyService: Failed to read XLSX: {e} (path: {xlsx_path})')
        self._cache = {"ts": time.time(), "rows": rows, "source": str(xlsx_path) if xlsx_path else ""}
        return list(rows)
    def search(
        self,
        q: str = "",
        limit: int = 10,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
        radius_km: Optional[float] = None,
        sort: str = "relevance",
        include_closed: bool = False,
    ) -> List[PharmacyItem]:
        print(f"[PharmacyService.search] q='{q}', limit={limit}, lat={lat}, lon={lon}, radius_km={radius_km}, sort={sort}")
        rows = self._fetch_rows_cached(limit=3000)
        print(f"[PharmacyService.search] loaded {len(rows)} rows from CSV")
        candidates = []
        query = str(q or '').strip()

        # xlsx의 모든 컬럼명을 동적으로 가져와 display_fields로 사용
        if rows:
            display_fields = list(rows[0].keys())
        else:
            display_fields = []

        import re
        def normalize_korean(text):
            # 한글 정규화, 대소문자 무시, 공백 제거
            import unicodedata
            if not isinstance(text, str):
                text = str(text)
            text = unicodedata.normalize('NFKC', text)
            text = text.lower().replace(' ', '')
            return text

        nq = normalize_korean(query)
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue

            display_row = {k: row.get(k, '') for k in display_fields}
            # 모든 컬럼을 검색 텍스트로 사용
            text = ' '.join([str(display_row.get(f, '')) for f in display_fields])
            ntext = normalize_korean(text)
            if idx < 10:
                print(f"[SEARCH-DEBUG] idx={idx}, query='{query}', text='{text}', nq='{nq}', ntext='{ntext}'")

            if not text:
                continue

            match = True
            if query:
                # 부분 일치(포함) + 한글 정규화 + 대소문자 무시 + 공백 무시
                match = nq in ntext
            if not query:
                match = True
            if not match:
                continue

            score = 1
            distance_km: Optional[float] = None
            out_lat: Optional[float] = None
            out_lon: Optional[float] = None

            # 좌표 추출
            rlat, rlon = _extract_lat_lon(row)
            out_lat, out_lon = (rlat, rlon)
            if lat is not None and lon is not None and rlat is not None and rlon is not None:
                distance_km = _haversine_km(lat, lon, rlat, rlon)
                if radius_km is not None and distance_km > radius_km:
                    continue
                if (radius_km is not None or sort == "distance") and (rlat is None or rlon is None):
                    continue

            # PharmacyItem 생성 시 display_row만 사용
            if out_lat is not None and out_lon is not None:
                # 사업장명 추출
                pharmacy_name = _pick_first(display_row, ['사업장명'])
                if not pharmacy_name:
                    pharmacy_name = "약국"
                
                # 주소 추출
                pharmacy_address = _pick_first(display_row, ['도로명주소', '지번주소'])
                if not pharmacy_address:
                    pharmacy_address = ""
                
                # 전화번호 추출
                pharmacy_phone = _pick_first(display_row, ['전화번호'])
                
                print(f"[ITEM-DEBUG] name={pharmacy_name}, address={pharmacy_address}, phone={pharmacy_phone}")
                
                item = PharmacyItem(
                    name=pharmacy_name,
                    address=pharmacy_address,
                    phone=pharmacy_phone,
                    distance_km=distance_km,
                    lat=out_lat,
                    lon=out_lon,
                    raw=display_row  # display_row만 포함
                )
                candidates.append((score, item))
            else:
                print(f"[SEARCH-DEBUG] lat/lon 없음: row={display_row}")

        print(f"[PharmacyService.search] candidates after filter = {len(candidates)}")

        def _sort_key(pair: tuple[int, PharmacyItem]):
            s, item = pair
            dist = item.distance_km
            dist_key = dist if dist is not None else 1e9
            if sort == "distance":
                return (dist_key, -s, item.name)
            return (-s, dist_key, item.name)

        candidates.sort(key=_sort_key)
        return [item for _, item in candidates[:limit]]

    def is_configured(self) -> bool:
        # 1) Local XLSX (no ODCloud creds required)
        if self._local_xlsx_path() is not None:
            return True

        # 2) ODCloud dataset
        creds_ok = bool((ODCLOUD_SERVICE_KEY or "").strip() or (ODCLOUD_AUTHORIZATION or "").strip())
        return bool((PHARMACY_SERVICE_PATH or "").strip()) and creds_ok

    def __init__(self, *, cache_ttl_s: float = 300.0) -> None:
        # 한국어: 약국 서비스 객체 초기화 시, 캐시 TTL 설정 및 데이터 캐시 초기화
        self._cache_ttl_s = cache_ttl_s
        self._cache = {"ts": 0, "rows": [], "source": ""}
