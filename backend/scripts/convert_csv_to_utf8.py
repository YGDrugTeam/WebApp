from __future__ import annotations

import argparse
import csv
from pathlib import Path


def _try_read_text(path: Path, encodings: list[str]) -> tuple[str, str]:
    last_err: Exception | None = None
    for enc in encodings:
        try:
            return path.read_text(encoding=enc), enc
        except Exception as e:  # pragma: no cover
            last_err = e
    raise RuntimeError(f"Failed to decode {path} using {encodings}: {last_err}")


def convert_csv_to_utf8(input_path: Path, output_path: Path, *, output_encoding: str = "utf-8-sig") -> dict:
    # NOTE: 'utf-8-sig' writes BOM which helps Excel display Korean correctly.
    input_text, used_encoding = _try_read_text(
        input_path,
        encodings=[
            "utf-8-sig",
            "utf-8",
            "cp949",
            "euc-kr",
        ],
    )

    # Normalize newlines for csv module
    lines = input_text.splitlines()

    reader = csv.reader(lines)
    rows = list(reader)
    if not rows:
        raise RuntimeError("CSV appears to be empty")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding=output_encoding, newline="") as f:
        writer = csv.writer(f)
        writer.writerows(rows)

    return {
        "input": str(input_path),
        "output": str(output_path),
        "input_encoding": used_encoding,
        "output_encoding": output_encoding,
        "rows": len(rows),
        "cols": len(rows[0]) if rows else 0,
        "header": rows[0],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="input", required=True)
    ap.add_argument("--out", dest="output", required=True)
    ap.add_argument(
        "--out-encoding",
        default="utf-8-sig",
        help="Default utf-8-sig (UTF-8 with BOM for Excel compatibility)",
    )
    args = ap.parse_args()

    info = convert_csv_to_utf8(Path(args.input), Path(args.output), output_encoding=str(args.out_encoding))
    print("OK")
    for k, v in info.items():
        print(f"{k}: {v}")


if __name__ == "__main__":
    main()
