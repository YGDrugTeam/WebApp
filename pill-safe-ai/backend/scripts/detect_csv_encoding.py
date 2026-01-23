from __future__ import annotations

import argparse
import csv
from pathlib import Path


CANDIDATE_ENCODINGS: list[str] = [
    "utf-8",
    "utf-8-sig",
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


def _try_decode(data: bytes, encoding: str) -> str | None:
    try:
        return data.decode(encoding)
    except UnicodeDecodeError:
        return None


def _sniff_dialect(sample: str) -> csv.Dialect | None:
    try:
        return csv.Sniffer().sniff(sample, delimiters=[",", "\t", ";", "|", "^"])
    except Exception:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Detect CSV encoding/delimiter and print a safe pandas read_csv hint.",
    )
    parser.add_argument("path", help="Path to the CSV file")
    parser.add_argument(
        "--sample-chars",
        type=int,
        default=2000,
        help="How many decoded characters to use for delimiter sniffing",
    )
    args = parser.parse_args()

    path = Path(args.path)
    data = path.read_bytes()

    print(f"path: {path}")
    print(f"size_bytes: {len(data)}")
    print(f"bom: {_detect_bom(data) or '(none)'}")
    print("first16_bytes:", data[:16])

    results: list[tuple[str, str]] = []

    for enc in CANDIDATE_ENCODINGS:
        decoded = _try_decode(data, enc)
        if decoded is None:
            print(f"{enc}: FAIL")
            continue

        sample = decoded[: args.sample_chars]
        dialect = _sniff_dialect(sample)
        delim = getattr(dialect, "delimiter", None) if dialect else None

        first_line = decoded.splitlines()[0] if decoded.splitlines() else ""
        print(f"{enc}: OK  delimiter={delim!r}  first_line={first_line[:160]!r}")
        results.append((enc, delim or ","))

    if not results:
        raise SystemExit("No candidate encodings worked. Try opening the file in a text editor to inspect encoding.")

    # Prefer BOM-informed encoding first, else prefer cp949 for KR datasets.
    bom_enc = _detect_bom(data)
    if bom_enc:
        chosen_enc = bom_enc
    else:
        preferred = ["cp949", "euc-kr", "utf-8-sig", "utf-8", "utf-16", "utf-16-le", "utf-16-be"]
        chosen_enc = next(enc for enc in preferred if any(r[0] == enc for r in results))

    chosen_delim = next(d for (e, d) in results if e == chosen_enc)

    print("\nRECOMMENDED")
    print(f"- encoding: {chosen_enc}")
    print(f"- delimiter: {chosen_delim!r}")
    print("\nPANDAS")
    print(
        "pd.read_csv(path, encoding='{}', sep='{}', dtype=str, keep_default_na=False)".format(
            chosen_enc, chosen_delim
        )
    )


if __name__ == "__main__":
    main()
