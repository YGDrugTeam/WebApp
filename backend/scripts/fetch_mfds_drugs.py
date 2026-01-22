from __future__ import annotations

import argparse
import os
import pathlib
import sys
from typing import Any, Dict, List, Tuple

# Allow running as: python backend/scripts/fetch_mfds_drugs.py
BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from mfds_openapi import MFDSOpenAPIClient, MFDSService, normalize_drug_item, save_json


DEFAULT_SERVICE_PATHS = {
    # MFDS "e약은요"(Easy Drug Info) service (commonly used on data.go.kr)
    # The exact path can vary by dataset version; override with --service-path.
    "easy": "/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList",
    # MFDS drug product permission info (example; may require a different path)
    "permit": "/1471000/DrugPrdtPrmsnInfoService/getDrugPrdtPrmsnInq",
    # Pill identification (example)
    "pill": "/1471000/MdcinGrnIdntfcInfoService/getMdcinGrnIdntfcInfoList",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch >=300 MFDS drug items via official OpenAPI (data.go.kr style).")
    p.add_argument("--api-key", default=os.getenv("MFDS_SERVICE_KEY") or os.getenv("SERVICE_KEY"))
    p.add_argument("--base-url", default=os.getenv("MFDS_API_BASE", "https://apis.data.go.kr"))

    p.add_argument("--preset", choices=sorted(DEFAULT_SERVICE_PATHS.keys()), default="easy")
    p.add_argument("--service-path", default=None, help="Override full service path, e.g. /1471000/DrbEasyDrugInfoService/getDrbEasyDrugList")

    p.add_argument("--limit", type=int, default=300)
    p.add_argument("--rows", type=int, default=100)
    p.add_argument("--out", default=os.path.join("backend", "data", "mfds_drugs.json"))
    p.add_argument("--raw", action="store_true", help="Store raw items without normalization")

    p.add_argument(
        "--param",
        action="append",
        default=[],
        help="Extra query param in key=value form. Repeatable. Example: --param itemName=타이레놀",
    )

    return p.parse_args()


def _parse_params(pairs: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for pair in pairs:
        if "=" not in pair:
            raise SystemExit(f"Invalid --param {pair!r}. Expected key=value")
        k, v = pair.split("=", 1)
        k = k.strip()
        if not k:
            raise SystemExit(f"Invalid --param {pair!r}. Empty key")
        out[k] = v
    return out


def main() -> int:
    args = parse_args()

    if not args.api_key:
        raise SystemExit(
            "Missing API key. Set MFDS_SERVICE_KEY env var or pass --api-key. "
            "You can request a service key from data.go.kr for the MFDS dataset you want."
        )

    service_path = args.service_path or DEFAULT_SERVICE_PATHS[args.preset]
    service = MFDSService(service_path=service_path)

    extra_params = _parse_params(args.param)

    client = MFDSOpenAPIClient(service_key=args.api_key, base_url=args.base_url)

    items: List[Dict[str, Any]] = client.fetch_items(
        service,
        limit=args.limit,
        rows=args.rows,
        extra_params=extra_params,
    )

    if args.raw:
        payload: Any = items
    else:
        payload = [normalize_drug_item(x) for x in items]

    save_json(args.out, payload)
    print(f"Fetched {len(items)} items -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
