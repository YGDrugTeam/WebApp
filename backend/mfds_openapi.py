from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


class MFDSOpenAPIError(RuntimeError):
    pass


@dataclass(frozen=True)
class MFDSService:
    """Represents a data.go.kr-style MFDS OpenAPI service endpoint."""

    # Example:
    #   service_path = "/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList"
    service_path: str

    # Most data.go.kr endpoints accept these query params.
    page_param: str = "pageNo"
    rows_param: str = "numOfRows"
    type_param: str = "type"  # many accept: type=json
    type_value: str = "json"


def _pick(d: Dict[str, Any], *keys: str) -> Optional[Any]:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _ensure_list(items: Any) -> List[Any]:
    if items is None:
        return []
    if isinstance(items, list):
        return items
    return [items]


def _extract_items(payload: Any) -> Tuple[List[Dict[str, Any]], Optional[int]]:
    """Best-effort extraction for data.go.kr JSON formats.

    Common shapes:
      {"response":{"body":{"items":{"item":[...]},"totalCount":123}}}
      {"response":{"body":{"items":[...],"totalCount":123}}}

    Returns: (items, totalCount)
    """

    if not isinstance(payload, dict):
        return ([], None)

    response_obj: Dict[str, Any]
    if isinstance(payload.get("response"), dict):
        response_obj = payload["response"]
    else:
        response_obj = payload

    body_obj: Dict[str, Any]
    if isinstance(response_obj.get("body"), dict):
        body_obj = response_obj["body"]
    else:
        body_obj = response_obj

    total_count_raw = body_obj.get("totalCount")
    total_count: Optional[int] = None
    if isinstance(total_count_raw, int):
        total_count = total_count_raw
    elif isinstance(total_count_raw, str):
        try:
            total_count = int(total_count_raw)
        except Exception:
            total_count = None

    items = body_obj.get("items")

    # items could be dict with key 'item'
    if isinstance(items, dict) and "item" in items:
        items = items.get("item")

    out: List[Dict[str, Any]] = []
    for item in _ensure_list(items):
        if isinstance(item, dict):
            out.append(item)

    return (out, total_count)


class MFDSOpenAPIClient:
    def __init__(
        self,
        service_key: str,
        base_url: str = "https://apis.data.go.kr",
        timeout_s: float = 20.0,
        min_interval_s: float = 0.2,
        user_agent: str = "pill-safe-ai/1.0 (+https://example.invalid)",
    ) -> None:
        self._service_key = service_key
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._min_interval_s = min_interval_s
        self._last_call = 0.0

        self._session = requests.Session()
        self._session.headers.update({"User-Agent": user_agent})

    def _sleep_if_needed(self) -> None:
        elapsed = time.time() - self._last_call
        if elapsed < self._min_interval_s:
            time.sleep(self._min_interval_s - elapsed)

    def _get(self, path: str, params: Dict[str, Any]) -> Any:
        self._sleep_if_needed()

        url = f"{self._base_url}{path}"
        try:
            resp = self._session.get(url, params=params, timeout=self._timeout_s)
            self._last_call = time.time()
        except requests.RequestException as e:
            raise MFDSOpenAPIError(f"Request failed: {e}") from e

        if resp.status_code >= 400:
            raise MFDSOpenAPIError(f"HTTP {resp.status_code}: {resp.text[:500]}")

        # Most endpoints return JSON when type=json.
        # If it returns XML anyway, surface a helpful error.
        ctype = resp.headers.get("Content-Type", "")
        if "json" not in ctype.lower():
            # Try JSON parse anyway (sometimes header is wrong)
            try:
                return resp.json()
            except Exception:
                raise MFDSOpenAPIError(
                    "Response is not JSON. Ensure the endpoint supports JSON and set type=json. "
                    f"Content-Type={ctype}, body_start={resp.text[:200]!r}"
                )

        try:
            return resp.json()
        except Exception as e:
            raise MFDSOpenAPIError(f"Invalid JSON: {e}; body_start={resp.text[:200]!r}") from e

    def iter_items(
        self,
        service: MFDSService,
        *,
        limit: int = 300,
        rows: int = 100,
        extra_params: Optional[Dict[str, Any]] = None,
        max_pages: int = 1000,
    ) -> Iterable[Dict[str, Any]]:
        """Iterate items from an MFDS/data.go.kr endpoint with pagination."""

        extra_params = dict(extra_params or {})
        page = 1
        yielded = 0
        total_count: Optional[int] = None

        while page <= max_pages and yielded < limit:
            params: Dict[str, Any] = {
                "serviceKey": self._service_key,
                service.page_param: page,
                service.rows_param: rows,
                service.type_param: service.type_value,
                **extra_params,
            }

            payload = self._get(service.service_path, params)
            items, total_count = _extract_items(payload)

            # Some endpoints return empty list but with totalCount; stop safely.
            if not items:
                break

            for item in items:
                if not isinstance(item, dict):
                    continue
                yield item
                yielded += 1
                if yielded >= limit:
                    break

            # Stop if we reached the known total
            if total_count is not None and page * rows >= total_count:
                break

            page += 1

    def fetch_items(
        self,
        service: MFDSService,
        *,
        limit: int = 300,
        rows: int = 100,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        return list(self.iter_items(service, limit=limit, rows=rows, extra_params=extra_params))

    def fetch_page(
        self,
        service: MFDSService,
        *,
        page: int = 1,
        rows: int = 100,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[int]]:
        """Fetch a single page and return (items, totalCount)."""

        extra_params = dict(extra_params or {})
        params: Dict[str, Any] = {
            "serviceKey": self._service_key,
            service.page_param: page,
            service.rows_param: rows,
            service.type_param: service.type_value,
            **extra_params,
        }

        payload = self._get(service.service_path, params)
        return _extract_items(payload)


def normalize_drug_item(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize common drug fields across MFDS endpoints (best-effort)."""

    name = _pick(raw, "itemName", "ITEM_NAME", "prdlstNm", "PRDLST_NM", "ENTP_ITEM_NAME")
    entp = _pick(raw, "entpName", "ENTP_NAME", "BSSH_NM")
    item_seq = _pick(raw, "itemSeq", "ITEM_SEQ", "PRDLST_REPORT_NO")

    # Common e약은요(DrbEasyDrugInfoService) fields (names vary by endpoint/version)
    efcy = _pick(raw, "efcyQesitm", "EFCY_QESITM")
    use_method = _pick(raw, "useMethodQesitm", "USE_METHOD_QESITM")
    warn = _pick(raw, "atpnWarnQesitm", "ATPN_WARN_QESITM")
    caution = _pick(raw, "atpnQesitm", "ATPN_QESITM")
    interaction = _pick(raw, "intrcQesitm", "INTRC_QESITM")
    side_effect = _pick(raw, "seQesitm", "SE_QESITM")
    storage = _pick(raw, "depositMethodQesitm", "DEPOSIT_METHOD_QESITM")

    return {
        "itemName": name,
        "entpName": entp,
        "itemSeq": item_seq,
        "efcy": efcy,
        "useMethod": use_method,
        "warn": warn,
        "caution": caution,
        "interaction": interaction,
        "sideEffect": side_effect,
        "storage": storage,
        "raw": raw,
    }


def save_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
