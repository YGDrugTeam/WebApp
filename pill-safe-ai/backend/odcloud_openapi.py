from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


class ODCloudOpenAPIError(RuntimeError):
    pass


@dataclass(frozen=True)
class ODCloudService:
    """Represents an api.odcloud.kr dataset endpoint."""

    # Example:
    #   service_path = "/15089525/v1/uddi:3f2efdac-942b-494e-919f-8bdc583f65ea"
    service_path: str

    page_param: str = "page"
    per_page_param: str = "perPage"
    return_type_param: str = "returnType"
    return_type_value: str = "JSON"


def _ensure_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


class ODCloudOpenAPIClient:
    def __init__(
        self,
        *,
        base_url: str = "https://api.odcloud.kr/api",
        service_key: str | None = None,
        authorization: str | None = None,
        timeout_s: float = 20.0,
        min_interval_s: float = 0.2,
        user_agent: str = "mediclens/1.0 (+https://example.invalid)",
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._service_key = (service_key or "").strip() or None
        self._authorization = (authorization or "").strip() or None
        self._timeout_s = timeout_s
        self._min_interval_s = min_interval_s
        self._last_call = 0.0

        self._session = requests.Session()
        self._session.headers.update({"User-Agent": user_agent})
        if self._authorization:
            self._session.headers.update({"Authorization": self._authorization})

    def _sleep_if_needed(self) -> None:
        elapsed = time.time() - self._last_call
        if elapsed < self._min_interval_s:
            time.sleep(self._min_interval_s - elapsed)

    def _get(self, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
        self._sleep_if_needed()

        url = f"{self._base_url}{path}"
        req_params = dict(params)
        if self._service_key and "serviceKey" not in req_params:
            req_params["serviceKey"] = self._service_key

        try:
            resp = self._session.get(url, params=req_params, timeout=self._timeout_s)
            self._last_call = time.time()
        except requests.RequestException as e:
            raise ODCloudOpenAPIError(f"Request failed: {e}") from e

        if resp.status_code >= 400:
            raise ODCloudOpenAPIError(f"HTTP {resp.status_code}: {resp.text[:500]}")

        try:
            return resp.json()
        except Exception as e:
            raise ODCloudOpenAPIError(f"Invalid JSON: {e}; body_start={resp.text[:200]!r}") from e

    def iter_rows(
        self,
        service: ODCloudService,
        *,
        limit: int = 1000,
        per_page: int = 100,
        extra_params: Optional[Dict[str, Any]] = None,
        max_pages: int = 200,
    ) -> Iterable[Dict[str, Any]]:
        extra_params = dict(extra_params or {})

        page = int(extra_params.pop(service.page_param, 1) or 1)
        yielded = 0

        while page <= max_pages and yielded < limit:
            params: Dict[str, Any] = {
                service.page_param: page,
                service.per_page_param: per_page,
                service.return_type_param: service.return_type_value,
                **extra_params,
            }

            payload = self._get(service.service_path, params)
            rows = payload.get("data")

            for row in _ensure_list(rows):
                if not isinstance(row, dict):
                    continue
                yield row
                yielded += 1
                if yielded >= limit:
                    break

            if not rows:
                break

            page += 1

    def fetch_rows(
        self,
        service: ODCloudService,
        *,
        limit: int = 1000,
        per_page: int = 100,
        extra_params: Optional[Dict[str, Any]] = None,
        max_pages: int = 200,
    ) -> List[Dict[str, Any]]:
        return list(self.iter_rows(service, limit=limit, per_page=per_page, extra_params=extra_params, max_pages=max_pages))


def normalize_text(value: Any) -> str:
    import re

    s = str(value or "").lower()
    s = s.replace("·", " ").replace("/", " ").replace("-", " ").replace("_", " ")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^0-9a-zA-Z가-힣\s.+-]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def score_match(query: str, target: str) -> int:
    if not query or not target:
        return 0
    if query == target:
        return 100
    if target.find(query) >= 0:
        return 85
    if query.find(target) >= 0:
        return 80

    q_tokens = set(query.split())
    t_tokens = set(target.split())
    if not q_tokens or not t_tokens:
        return 0

    inter = sum(1 for t in q_tokens if t in t_tokens)
    union = len(q_tokens) + len(t_tokens) - inter
    return round((inter / union) * 60) if union else 0


def row_product_names(row: Dict[str, Any]) -> Tuple[str | None, str | None]:
    """Best-effort extraction for product-name pairs in DUR rows."""

    # Known variants in different snapshots
    a = row.get("제품명A") or row.get("제품명1") or row.get("제품명")
    b = row.get("제품명B") or row.get("제품명2")

    a = str(a).strip() if a else None
    b = str(b).strip() if b else None
    return (a or None, b or None)


def row_product_codes(row: Dict[str, Any]) -> Tuple[str | None, str | None]:
    """Best-effort extraction for product-code pairs in DUR rows."""

    # Common variants
    a = row.get("제품코드A") or row.get("제품코드1") or row.get("의약품코드") or row.get("대상의약품코드")
    b = row.get("제품코드B") or row.get("제품코드2") or row.get("대상의약품코드")

    a = str(a).strip() if a else None
    b = str(b).strip() if b else None
    return (a or None, b or None)


def row_reason(row: Dict[str, Any]) -> str:
    for k in ("금기사유", "상세정보", "기사유", "비고"):
        v = row.get(k)
        if v:
            return str(v).strip()
    return ""


def row_ingredient_names(row: Dict[str, Any]) -> Tuple[str | None, str | None]:
    """Best-effort extraction for ingredient-name pairs in DUR rows."""

    # Common variants across snapshots
    a = row.get("성분명A") or row.get("성분명1") or row.get("금기성분명")
    b = row.get("성분명B") or row.get("성분명2") or row.get("대상성분명")

    a = str(a).strip() if a else None
    b = str(b).strip() if b else None
    return (a or None, b or None)


def row_ingredient_codes(row: Dict[str, Any]) -> Tuple[str | None, str | None]:
    """Best-effort extraction for ingredient-code pairs in DUR rows."""

    a = row.get("성분코드A") or row.get("성분코드1")
    b = row.get("성분코드B") or row.get("성분코드2")

    a = str(a).strip() if a else None
    b = str(b).strip() if b else None
    return (a or None, b or None)


def _normalize_for_match(value: Any) -> str:
    return normalize_text(value)


def match_row_to_pair_ingredients(
    row: Dict[str, Any],
    left_ingredients: List[str] | None,
    right_ingredients: List[str] | None,
) -> bool:
    """Try ingredient-based matching: row ingredient A/B vs inferred ingredients."""

    if not left_ingredients or not right_ingredients:
        return False

    ra_name, rb_name = row_ingredient_names(row)
    ra_code, rb_code = row_ingredient_codes(row)

    # If the row only has product-level info, ingredient match is not possible.
    if not (ra_name or rb_name or ra_code or rb_code):
        return False

    left_norm = [_normalize_for_match(x) for x in left_ingredients if str(x or "").strip()]
    right_norm = [_normalize_for_match(x) for x in right_ingredients if str(x or "").strip()]
    left_norm = [x for x in left_norm if x]
    right_norm = [x for x in right_norm if x]
    if not left_norm or not right_norm:
        return False

    # If row provides codes, attempt exact containment (code values are usually stable).
    if ra_code and rb_code:
        return (ra_code in left_norm and rb_code in right_norm) or (ra_code in right_norm and rb_code in left_norm)

    # Otherwise match by ingredient names with a high threshold.
    ra = _normalize_for_match(ra_name) if ra_name else ""
    rb = _normalize_for_match(rb_name) if rb_name else ""
    if not ra or not rb:
        return False

    def has_match(q: str, cands: List[str]) -> bool:
        return any(score_match(q, t) >= 85 for t in cands)

    return (has_match(ra, left_norm) and has_match(rb, right_norm)) or (has_match(ra, right_norm) and has_match(rb, left_norm))


def match_row_to_pair(
    row: Dict[str, Any],
    left: str,
    right: str,
    *,
    left_code: str | None = None,
    right_code: str | None = None,
) -> bool:
    # Code-first exact match when codes are provided.
    if left_code and right_code:
        ra, rb = row_product_codes(row)
        if ra and rb:
            if (left_code == ra and right_code == rb) or (left_code == rb and right_code == ra):
                return True

    a, b = row_product_names(row)
    if not a or not b:
        return False

    lq = normalize_text(left)
    rq = normalize_text(right)
    if not lq or not rq:
        return False

    an = normalize_text(a)
    bn = normalize_text(b)

    def ok(x: str, y: str) -> bool:
        s = score_match(x, y)
        return s >= 70

    return (ok(lq, an) and ok(rq, bn)) or (ok(lq, bn) and ok(rq, an))
