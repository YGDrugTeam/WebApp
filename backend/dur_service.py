from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

try:
    # When running from backend/ directory
    from odcloud_openapi import (
        ODCloudOpenAPIClient,
        ODCloudOpenAPIError,
        ODCloudService,
        match_row_to_pair,
        row_ingredient_names,
        row_product_names,
        row_reason,
    )
    from settings import (
        DUR_SERVICE_PATH,
        ODCLOUD_API_BASE,
        ODCLOUD_AUTHORIZATION,
        ODCLOUD_SERVICE_KEY,
    )
except Exception:  # pragma: no cover
    # When imported as a package (e.g., backend.dur_service)
    from .odcloud_openapi import (
        ODCloudOpenAPIClient,
        ODCloudOpenAPIError,
        ODCloudService,
        match_row_to_pair,
        row_ingredient_names,
        row_product_names,
        row_reason,
    )
    from .settings import (
        DUR_SERVICE_PATH,
        ODCLOUD_API_BASE,
        ODCLOUD_AUTHORIZATION,
        ODCLOUD_SERVICE_KEY,
    )


class DurServiceError(RuntimeError):
    def __init__(self, message: str, *, code: str = "DUR_ERROR", public_message: Optional[str] = None) -> None:
        super().__init__(message)
        self.code = code
        self.public_message = public_message or "병용 금기 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요."


@dataclass
class DurHit:
    left: str
    right: str
    reason: str
    ingredient_a: Optional[str]
    ingredient_b: Optional[str]
    product_a: Optional[str]
    product_b: Optional[str]
    raw: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "left": self.left,
            "right": self.right,
            "reason": self.reason,
            "ingredientA": self.ingredient_a,
            "ingredientB": self.ingredient_b,
            "productA": self.product_a,
            "productB": self.product_b,
            "raw": self.raw,
        }


class DurService:
    """Best-effort DUR/병용금기 checker backed by ODCloud dataset.

    Requires DUR_SERVICE_PATH and ODCloud credentials.
    """

    def __init__(self, *, cache_ttl_s: float = 3600.0) -> None:
        self._cache_ttl_s = cache_ttl_s
        self._cache: Dict[str, Any] = {"ts": 0.0, "rows": []}

    def is_configured(self) -> bool:
        has_path = bool(str(DUR_SERVICE_PATH or "").strip())
        has_auth = bool(str(ODCLOUD_SERVICE_KEY or "").strip()) or bool(str(ODCLOUD_AUTHORIZATION or "").strip())
        return has_path and has_auth

    def _require_config(self) -> None:
        if not bool(str(DUR_SERVICE_PATH or "").strip()):
            raise DurServiceError(
                "DUR_SERVICE_PATH is not configured",
                code="DUR_NOT_CONFIGURED",
                public_message="현재 병용 금기 기능을 사용할 수 없어요. (DUR_SERVICE_PATH 설정 필요)",
            )
        if not (bool(str(ODCLOUD_SERVICE_KEY or "").strip()) or bool(str(ODCLOUD_AUTHORIZATION or "").strip())):
            raise DurServiceError(
                "ODCloud credentials are not configured",
                code="DUR_NOT_CONFIGURED",
                public_message="현재 병용 금기 기능을 사용할 수 없어요. (ODCLOUD_SERVICE_KEY 또는 ODCLOUD_AUTHORIZATION 설정 필요)",
            )

    def _client(self) -> ODCloudOpenAPIClient:
        return ODCloudOpenAPIClient(
            base_url=ODCLOUD_API_BASE,
            service_key=ODCLOUD_SERVICE_KEY or None,
            authorization=ODCLOUD_AUTHORIZATION or None,
        )

    def _fetch_rows_cached(self, *, limit: int = 5000, per_page: int = 200) -> List[Dict[str, Any]]:
        self._require_config()

        now = time.time()
        if self._cache["rows"] and (now - float(self._cache["ts"])) < self._cache_ttl_s:
            return list(self._cache["rows"])

        service = ODCloudService(service_path=str(DUR_SERVICE_PATH))
        try:
            rows = self._client().fetch_rows(service, limit=limit, per_page=per_page)
        except ODCloudOpenAPIError as e:
            raise DurServiceError(
                str(e),
                code="DUR_UPSTREAM_ERROR",
                public_message="병용 금기 데이터를 불러오는 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.",
            ) from e

        self._cache = {"ts": now, "rows": rows}
        return list(rows)

    def check_pairs(self, drugs: List[str]) -> List[DurHit]:
        """Return contraindication hits for all drug name pairs."""

        self._require_config()

        names = [str(x or "").strip() for x in (drugs or [])]
        names = [x for x in names if x]
        # de-dup while preserving order
        seen: set[str] = set()
        uniq: List[str] = []
        for n in names:
            key = n.lower()
            if key in seen:
                continue
            seen.add(key)
            uniq.append(n)

        if len(uniq) < 2:
            return []

        rows = self._fetch_rows_cached()
        hits: List[DurHit] = []

        from odcloud_openapi import row_ingredient_names, match_row_to_pair, normalize_text
        # 성분명 추출을 위해 pill_data_final_remake 1.json을 로드 (최초 1회 캐시)
        import os, json
        pill_data_path = os.path.join(os.path.dirname(__file__), 'data', 'pill_data_final_remake 1.json')
        _pill_data_cache = getattr(self, '_pill_data_cache', None)
        if _pill_data_cache is None:
            try:
                with open(pill_data_path, encoding='utf-8') as f:
                    _pill_data_cache = json.load(f)
            except Exception:
                _pill_data_cache = {}
            self._pill_data_cache = _pill_data_cache

        def get_ingredients(name):
            # 제품명/성분명 모두 정규화
            for k, v in (_pill_data_cache or {}).items():
                n = v.get('name') or v.get('제품명') or v.get('ITEM_NAME')
                if n and normalize_text(n) == normalize_text(name):
                    ings = v.get('ingredient') or v.get('성분') or v.get('주성분')
                    if ings:
                        # 콤마/슬래시/공백 등으로 분리
                        return [normalize_text(x) for x in str(ings).replace('/',',').split(',') if x.strip()]
            return []

        for i in range(len(uniq)):
            for j in range(i + 1, len(uniq)):
                left = uniq[i]
                right = uniq[j]
                found = False
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    if match_row_to_pair(row, left, right):
                        pa, pb = row_product_names(row)
                        ia, ib = row_ingredient_names(row)
                        reason = row_reason(row)
                        hits.append(DurHit(
                            left=left,
                            right=right,
                            reason=reason,
                            ingredient_a=ia,
                            ingredient_b=ib,
                            product_a=pa,
                            product_b=pb,
                            raw=row,
                        ))
                        found = True
                        break
                if not found:
                    # 제품명 매칭 실패 시 성분명 기반 매칭 시도
                    left_ings = get_ingredients(left)
                    right_ings = get_ingredients(right)
                    if left_ings and right_ings:
                        for row in rows:
                            ia, ib = row_ingredient_names(row)
                            if not ia or not ib:
                                continue
                            # 양쪽 성분명 모두에 대해 정규화 후 비교
                            if (any(normalize_text(ia) == li for li in left_ings) and any(normalize_text(ib) == ri for ri in right_ings)) or \
                               (any(normalize_text(ib) == li for li in left_ings) and any(normalize_text(ia) == ri for ri in right_ings)):
                                pa, pb = row_product_names(row)
                                reason = row_reason(row)
                                hits.append(DurHit(
                                    left=left,
                                    right=right,
                                    reason=reason + ' (성분명 기반 매칭)',
                                    ingredient_a=ia,
                                    ingredient_b=ib,
                                    product_a=pa,
                                    product_b=pb,
                                    raw=row,
                                ))
                                break

        return hits
