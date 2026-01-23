from __future__ import annotations

import argparse
from pathlib import Path


CANDIDATE_ENCODINGS: list[str] = [
    "utf-8-sig",
    "utf-8",
    "cp949",
    "euc-kr",
    "utf-16",
    "utf-16-le",
    "utf-16-be",
]


def _detect_bom(data: bytes) -> str | None:
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if data.startswith(b"\xff\xfe"):
        return "utf-16-le"
    if data.startswith(b"\xfe\xff"):
        return "utf-16-be"
    return None


def _decode_with_fallback(data: bytes, preferred: str | None = None) -> tuple[str, str]:
    tried: list[str] = []

    bom = _detect_bom(data)
    if bom:
        preferred = bom

    if preferred:
        tried.append(preferred)
        try:
            return data.decode(preferred), preferred
        except UnicodeDecodeError:
            pass

    for enc in CANDIDATE_ENCODINGS:
        if enc in tried:
            continue
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue

    raise UnicodeDecodeError("unknown", b"", 0, 1, "No candidate encoding worked")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert a CSV file to UTF-8 (with BOM) for Excel/pandas compatibility.",
    )
    parser.add_argument("input", help="Input CSV path")
    parser.add_argument(
        "--in-encoding",
        default="auto",
        help="Input encoding (default: auto; tries BOM then common encodings)",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output path (default: <input>.utf8.csv)",
    )
    parser.add_argument(
        "--out-encoding",
        default="utf-8-sig",
        help="Output encoding (default: utf-8-sig)",
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    data = input_path.read_bytes()

    preferred = None if args.in_encoding == "auto" else args.in_encoding
    text, used = _decode_with_fallback(data, preferred=preferred)

    out_path = Path(args.out) if args.out else input_path.with_suffix(input_path.suffix + ".utf8.csv")
    out_path.write_text(text, encoding=args.out_encoding, newline="")

    print(f"input: {input_path}")
    print(f"detected_input_encoding: {used}")
    print(f"output: {out_path}")
    print(f"output_encoding: {args.out_encoding}")


if __name__ == "__main__":
    main()
