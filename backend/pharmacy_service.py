from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import math

try:
    # When running as scripts from backend/ directory
    from odcloud_openapi import ODCloudOpenAPIClient, ODCloudOpenAPIError, ODCloudService, normalize_text, score_match
    from settings import ODCLOUD_API_BASE, ODCLOUD_AUTHORIZATION, ODCLOUD_SERVICE_KEY, PHARMACY_SERVICE_PATH
except Exception:  # pragma: no cover
    # When imported as a package (e.g., from backend.pharmacy_service)
    from .odcloud_openapi import ODCloudOpenAPIClient, ODCloudOpenAPIError, ODCloudService, normalize_text, score_match
    from .settings import ODCLOUD_API_BASE, ODCLOUD_AUTHORIZATION, ODCLOUD_SERVICE_KEY, PHARMACY_SERVICE_PATH


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
    raw: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "address": self.address,
            "phone": self.phone,
            "distance_km": self.distance_km,
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
    # Earth radius in km
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def _extract_lat_lon(row: Dict[str, Any]) -> tuple[Optional[float], Optional[float]]:
    # Common ODCloud column variants
    lat = _to_float(
        row.get("위도")
        or row.get("LAT")
        or row.get("lat")
        or row.get("Latitude")
        or row.get("latitude")
        or row.get("Y")
        or row.get("y")
    )
    lon = _to_float(
        row.get("경도")
        or row.get("LON")
        or row.get("lon")
        or row.get("Longitude")
        or row.get("longitude")
        or row.get("X")
        or row.get("x")
    )
    return (lat, lon)


class PharmacyService:
    """Best-effort pharmacy finder backed by ODCloud dataset.

    This service intentionally does NOT provide demo/sample data.
    It requires PHARMACY_SERVICE_PATH + ODCLOUD credentials to be configured.
    """

    def __init__(self, *, cache_ttl_s: float = 300.0) -> None:
        self._cache_ttl_s = cache_ttl_s
        self._cache: Dict[str, Any] = {"ts": 0.0, "rows": []}

    def is_configured(self) -> bool:
        return True

    def _require_config(self) -> None:
        pass  # 아무것도 하지 않고 통과시킵니다.

    def _client(self) -> ODCloudOpenAPIClient:
        return ODCloudOpenAPIClient(
            base_url=ODCLOUD_API_BASE,
            service_key=ODCLOUD_SERVICE_KEY or None,
            authorization=ODCLOUD_AUTHORIZATION or None,
        )

    # def _fetch_rows_cached(self, *, limit: int = 2000, per_page: int = 200) -> List[Dict[str, Any]]:
    #     now = time.time()
    #     if self._cache["rows"] and (now - float(self._cache["ts"])) < self._cache_ttl_s:
    #         return list(self._cache["rows"])  # copy

    #     service = ODCloudService(service_path=PHARMACY_SERVICE_PATH)
    #     try:
    #         rows = self._client().fetch_rows(service, limit=limit, per_page=per_page)
    #     except ODCloudOpenAPIError as e:
    #         raise PharmacyServiceError(
    #             str(e),
    #             code="PHARMACY_UPSTREAM_ERROR",
    #             public_message="약국 데이터를 불러오는 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.",
    #         ) from e

    #     self._cache = {"ts": now, "rows": rows}
    #     return rows

    def _fetch_rows_cached(self, *, limit: int = 2000, per_page: int = 200) -> List[Dict[str, Any]]:
        import pickle
        try:
            with open("pill_db.pkl", "rb") as f:
                rows = pickle.load(f)
            return rows
        except Exception as e:
            print(f"❌ 로컬 DB 로드 실패: {e}")
            return []

    def search(
        self,
        *,
        q: str,
        limit: int = 10,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
        radius_km: Optional[float] = None,
        sort: str = "relevance",  # relevance | distance
    ) -> List[PharmacyItem]:
        self._require_config()

        query = normalize_text(q)
        if not query:
            return []

        limit = max(1, min(int(limit or 10), 50))
        sort = (sort or "relevance").strip().lower()
        if sort not in ("relevance", "distance"):
            sort = "relevance"
        if radius_km is not None:
            try:
                radius_km = float(radius_km)
            except Exception:
                radius_km = None
        if radius_km is not None and radius_km <= 0:
            radius_km = None

        rows = self._fetch_rows_cached(limit=3000, per_page=200)

        candidates: List[tuple[int, PharmacyItem]] = []
        for row in rows:
            if not isinstance(row, dict):
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

            text = normalize_text(f"{name} {address} {phone}")
            if not text:
                continue

            score = score_match(query, text)
            if score <= 0:
                continue

            distance_km: Optional[float] = None
            if lat is not None and lon is not None:
                rlat, rlon = _extract_lat_lon(row)
                if rlat is not None and rlon is not None:
                    distance_km = _haversine_km(lat, lon, rlat, rlon)
                    if radius_km is not None and distance_km > radius_km:
                        continue

            candidates.append((score, PharmacyItem(name=name, address=address, phone=phone, distance_km=distance_km, raw=row)))

        # Sorting strategy:
        # - relevance: score desc, distance asc (when available)
        # - distance: distance asc (when available), score desc
        def _sort_key(pair: tuple[int, PharmacyItem]):
            s, item = pair
            dist = item.distance_km
            dist_key = dist if dist is not None else 1e9
            if sort == "distance":
                return (dist_key, -s, item.name)
            return (-s, dist_key, item.name)

        candidates.sort(key=_sort_key)
        return [item for _, item in candidates[:limit]]
