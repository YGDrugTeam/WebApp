from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import csv
from pathlib import Path

# Optional coordinate conversion
try:  # pragma: no cover
    from pyproj import CRS, Transformer
except Exception:  # pragma: no cover
    CRS = None
    Transformer = None

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
        }


def _pick_first(row: Dict[str, Any], keys: List[str]) -> str:
    for k in keys:
        v = row.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        s = str(value).strip()
        if not s:
            return None
        return float(s)
    except Exception:
        return None


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
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
        return (lat, lon)

    # If values look like degrees (already lon/lat), handle that too.
    if 120.0 <= x <= 135.0 and 30.0 <= y <= 45.0:
        return (y, x)

    if Transformer is None:
        # Don't return projected coordinates as lat/lon.
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
    return (lat, lon) if (lat and lon and abs(lat) <= 90 and abs(lon) <= 180) else (None, None)



class PharmacyService:

    def _fetch_rows_cached(self, *, limit: int = 3000, per_page: int = 200) -> List[Dict[str, Any]]:
        now = time.time()
        if self._cache["rows"] and (now - float(self._cache["ts"])) < self._cache_ttl_s:
            return list(self._cache["rows"])

        csv_path = self._local_csv_path()
        rows: List[Dict[str, Any]] = []
        if csv_path:
            try:
                with open(csv_path, encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    for i, row in enumerate(reader):
                        if i >= limit:
                            break
                        rows.append(row)
            except Exception as e:
                import logging
                logging.error(f'PharmacyService: Failed to read CSV: {e}')
        self._cache = {"ts": now, "rows": rows, "source": str(csv_path) if csv_path else ""}
        return list(rows)
    def search(
        self,
        q: str = "",
        limit: int = 10,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
        radius_km: Optional[float] = None,
        sort: str = "relevance",
    ) -> List[PharmacyItem]:
        print(f"[PharmacyService.search] q='{q}', limit={limit}, lat={lat}, lon={lon}, radius_km={radius_km}, sort={sort}")
        rows = self._fetch_rows_cached(limit=3000)
        print(f"[PharmacyService.search] loaded {len(rows)} rows from CSV")
        candidates = []
        query = str(q or '').strip()
        for row in rows:
            if not isinstance(row, dict):
                continue

            # 영업상태 필터: '영업' 또는 '영업/정상'이 포함된 모든 상태 허용 (두 컬럼 모두 검사)
            status_main = str(row.get('영업상태명') or '').strip()
            status_detail = str(row.get('상세영업상태명') or '').strip()
            if not (('영업' in status_main or '영업' in status_detail)):
                continue

            name = _pick_first(
                row,
                [
                    "약국명",
                    "기관명",
                    "요양기관명",
                    "상호",
                    "상호명",
                    "명칭",
                    "사업장명",
                    "name",
                ],
            )
            address = _pick_first(
                row,
                [
                    "주소",
                    "도로명주소",
                    "소재지도로명주소",
                    "소재지 지번주소",
                    "지번주소",
                    "소재지주소",
                    "address",
                ],
            )
            phone = _pick_first(row, ["전화번호", "대표전화", "연락처", "전화", "tel", "phone"])

            # 검색어가 약국명, 주소, 사업장명, 상세주소 등 다양한 필드에 대해 매칭되도록 확장
            extra_fields = [
                row.get('사업장명', ''),
                row.get('도로명주소', ''),
                row.get('지번주소', ''),
                row.get('상세영업상태명', ''),
            ]
            text = f"{name} {address} {phone} {' '.join(map(str, extra_fields))}"
            if not text:
                continue

            # robust substring match (case-insensitive)
            match = True
            if query:
                nq = normalize_text(query)
                ntext = normalize_text(text)
                match = nq in ntext
                if match:
                    print(f"[PharmacyService.search] MATCH: query='{nq}' in text='{ntext[:80]}...' (name={name})")
            if not match:
                continue

            score = 1  # all matches get equal score for substring search

            distance_km: Optional[float] = None
            out_lat: Optional[float] = None
            out_lon: Optional[float] = None

            # [한글 주석] 좌표가 있으면 거리 계산, 없으면 거리 기반 검색에서는 제외, 그 외에는 포함
            if lat is not None and lon is not None:
                rlat, rlon = _extract_lat_lon(row)
                out_lat, out_lon = (rlat, rlon)
                if rlat is not None and rlon is not None:
                    distance_km = _haversine_km(lat, lon, rlat, rlon)
                    if radius_km is not None and distance_km > radius_km:
                        continue
                # [한글 주석] 거리/반경 기반 검색에서 좌표가 없으면 제외
                if (radius_km is not None or sort == "distance") and (rlat is None or rlon is None):
                    continue
            # [한글 주석] 좌표가 없어도 거리 기반이 아니면 결과에 포함
            if out_lat is None or out_lon is None:
                rlat, rlon = _extract_lat_lon(row)
                out_lat, out_lon = (rlat, rlon)

            candidates.append(
                (
                    score,
                    PharmacyItem(
                        name=name,
                        address=address,
                        phone=phone,
                        distance_km=distance_km,
                        lat=out_lat,
                        lon=out_lon,
                        raw=row,
                    ),
                )
            )

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
        # 1) Local CSV (no ODCloud creds required)
        if self._local_csv_path() is not None:
            return True

        # 2) ODCloud dataset
        creds_ok = bool((ODCLOUD_SERVICE_KEY or "").strip() or (ODCLOUD_AUTHORIZATION or "").strip())
        return bool((PHARMACY_SERVICE_PATH or "").strip()) and creds_ok

    def __init__(self, *, cache_ttl_s: float = 300.0) -> None:

        for row in rows:
            if not isinstance(row, dict):
                continue

            # 영업상태 필터: '영업' 또는 '영업/정상'이 포함된 모든 상태 허용 (두 컬럼 모두 검사)
            status_main = str(row.get('영업상태명') or '').strip()
            status_detail = str(row.get('상세영업상태명') or '').strip()
            if not (('영업' in status_main or '영업' in status_detail)):
                continue

            name = _pick_first(
                row,
                [
                    "약국명",
                    "기관명",
                    "요양기관명",
                    "상호",
                    "상호명",
                    "명칭",
                    "사업장명",
                    "name",
                ],
            )
            address = _pick_first(
                row,
                [
                    "주소",
                    "도로명주소",
                    "소재지도로명주소",
                    "소재지 지번주소",
                    "지번주소",
                    "소재지주소",
                    "address",
                ],
            )
            phone = _pick_first(row, ["전화번호", "대표전화", "연락처", "전화", "tel", "phone"])

            # 검색어가 약국명, 주소, 사업장명, 상세주소 등 다양한 필드에 대해 매칭되도록 확장
            extra_fields = [
                row.get('사업장명', ''),
                row.get('도로명주소', ''),
                row.get('지번주소', ''),
                row.get('상세영업상태명', ''),
            ]
            text = f"{name} {address} {phone} {' '.join(map(str, extra_fields))}"
            if not text:
                continue

            # robust substring match (case-insensitive)
            match = True
            if query:
                nq = normalize_text(query)
                ntext = normalize_text(text)
                match = nq in ntext
            if not match:
                continue

            score = 1  # all matches get equal score for substring search

            distance_km: Optional[float] = None
            out_lat: Optional[float] = None
            out_lon: Optional[float] = None

            # [한글 주석] 좌표가 있으면 거리 계산, 없으면 거리 기반 검색에서는 제외, 그 외에는 포함
            if lat is not None and lon is not None:
                rlat, rlon = _extract_lat_lon(row)
                out_lat, out_lon = (rlat, rlon)
                if rlat is not None and rlon is not None:
                    distance_km = _haversine_km(lat, lon, rlat, rlon)
                    if radius_km is not None and distance_km > radius_km:
                        continue
                # [한글 주석] 거리/반경 기반 검색에서 좌표가 없으면 제외
                if (radius_km is not None or sort == "distance") and (rlat is None or rlon is None):
                    continue
            # [한글 주석] 좌표가 없어도 거리 기반이 아니면 결과에 포함
            if out_lat is None or out_lon is None:
                rlat, rlon = _extract_lat_lon(row)
                out_lat, out_lon = (rlat, rlon)

            candidates.append(
                (
                    score,
                    PharmacyItem(
                        name=name,
                        address=address,
                        phone=phone,
                        distance_km=distance_km,
                        lat=out_lat,
                        lon=out_lon,
                        raw=row,
                    ),
                )
            )

            distance_km: Optional[float] = None
            out_lat: Optional[float] = None
            out_lon: Optional[float] = None

            # [한글 주석] 좌표가 있으면 거리 계산, 없으면 거리 기반 검색에서는 제외, 그 외에는 포함
            if lat is not None and lon is not None:
                rlat, rlon = _extract_lat_lon(row)
                out_lat, out_lon = (rlat, rlon)
                if rlat is not None and rlon is not None:
                    distance_km = _haversine_km(lat, lon, rlat, rlon)
                    if radius_km is not None and distance_km > radius_km:
                        continue
                    if score <= 0 and (radius_km is not None or sort == "distance"):
                        score = 1
                # [한글 주석] 거리/반경 기반 검색에서 좌표가 없으면 제외
                if (radius_km is not None or sort == "distance") and (rlat is None or rlon is None):
                    continue
            if score <= 0:
                continue
            # [한글 주석] 좌표가 없어도 거리 기반이 아니면 결과에 포함
            if out_lat is None or out_lon is None:
                rlat, rlon = _extract_lat_lon(row)
                out_lat, out_lon = (rlat, rlon)

            candidates.append(
                (
                    score,
                    PharmacyItem(
                        name=name,
                        address=address,
                        phone=phone,
                        distance_km=distance_km,
                        lat=out_lat,
                        lon=out_lon,
                        raw=row,
                    ),
                )
            )

        print(f"PharmacyService: candidates after filter = {len(candidates)}")

        def _sort_key(pair: tuple[int, PharmacyItem]):
            s, item = pair
            dist = item.distance_km
            dist_key = dist if dist is not None else 1e9
            if sort == "distance":
                # Removed old initialization code
            return (-s, dist_key, item.name)


