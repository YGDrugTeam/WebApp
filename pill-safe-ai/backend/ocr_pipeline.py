from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import cv2
import numpy as np

try:
    from backend.model import ocr_reader_with_boxes
except Exception:  # pragma: no cover
    from model import ocr_reader_with_boxes


@dataclass(frozen=True)
class OcrAttempt:
    region: str
    variant: str
    score: float
    text: str


def _dedup_merge_texts(texts: list[str]) -> str:
    out: list[str] = []
    seen = set()
    for t in texts:
        s = str(t or "").strip()
        if not s:
            continue
        key = " ".join(s.lower().split())
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return " ".join(out).strip()


def _safe_imdecode(raw: bytes) -> np.ndarray:
    data = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("invalid_image")
    return img


def _resize_max_side(img: np.ndarray, max_side: int = 1600) -> np.ndarray:
    h, w = img.shape[:2]
    if max(h, w) <= max_side:
        return img
    scale = float(max_side) / float(max(h, w))
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)


def _to_gray(img: np.ndarray) -> np.ndarray:
    if len(img.shape) == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _clahe(gray: np.ndarray) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _otsu(gray: np.ndarray) -> np.ndarray:
    _, thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thr


def _adaptive(gray: np.ndarray) -> np.ndarray:
    # Good for uneven lighting on packaging.
    return cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        41,
        11,
    )


def _sharpen(gray: np.ndarray) -> np.ndarray:
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
    return cv2.filter2D(gray, -1, kernel)


def _preprocess_variants(img_bgr: np.ndarray, *, mode: str = "auto") -> list[tuple[str, np.ndarray]]:
    gray = _to_gray(img_bgr)
    gray = cv2.bilateralFilter(gray, 7, 50, 50)

    clahe = _clahe(gray)
    sharp = _sharpen(clahe)

    m = str(mode or "auto").strip().lower()
    if m not in {"auto", "box", "pill"}:
        m = "auto"

    # Feed EasyOCR a mix of grayscale and binarized images.
    otsu = _otsu(clahe)
    otsu_inv = cv2.bitwise_not(otsu)
    adap = _adaptive(clahe)
    adap_inv = cv2.bitwise_not(adap)

    if m == "pill":
        # Imprints often benefit from sharpening + inverted binarization.
        return [
            ("sharp", sharp),
            ("otsu_inv", otsu_inv),
            ("adaptive_inv", adap_inv),
            ("clahe", clahe),
            ("gray", gray),
            ("otsu", otsu),
            ("adaptive", adap),
        ]

    if m == "box":
        # Packaging text tends to work well with contrast + normal binarization.
        return [
            ("clahe", clahe),
            ("otsu", otsu),
            ("adaptive", adap),
            ("sharp", sharp),
            ("gray", gray),
            ("otsu_inv", otsu_inv),
            ("adaptive_inv", adap_inv),
        ]

    return [
        ("clahe", clahe),
        ("sharp", sharp),
        ("otsu", otsu),
        ("otsu_inv", otsu_inv),
        ("adaptive", adap),
        ("adaptive_inv", adap_inv),
        ("gray", gray),
    ]


def _order_points(pts: np.ndarray) -> np.ndarray:
    # pts: (4,2)
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # top-left
    rect[2] = pts[np.argmax(s)]  # bottom-right
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # top-right
    rect[3] = pts[np.argmax(diff)]  # bottom-left
    return rect


def _warp_quad(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    rect = _order_points(quad.astype(np.float32))
    (tl, tr, br, bl) = rect

    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_w = int(max(width_a, width_b))

    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_h = int(max(height_a, height_b))

    max_w = max(1, min(max_w, 2000))
    max_h = max(1, min(max_h, 2000))

    dst = np.array(
        [[0, 0], [max_w - 1, 0], [max_w - 1, max_h - 1], [0, max_h - 1]],
        dtype=np.float32,
    )

    m = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img, m, (max_w, max_h))
    return warped


def _propose_box_region(img_bgr: np.ndarray) -> np.ndarray | None:
    # Try to find a big rectangular-ish contour (package front).
    gray = _to_gray(img_bgr)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 60, 180)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None

    h, w = gray.shape[:2]
    img_area = float(h * w)

    best = None
    best_area = 0.0

    for c in cnts:
        area = float(cv2.contourArea(c))
        if area < img_area * 0.12:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) != 4:
            continue
        if area > best_area:
            best_area = area
            best = approx.reshape(4, 2)

    if best is None:
        return None

    try:
        warped = _warp_quad(img_bgr, best)
    except Exception:
        return None

    # Reject degenerate warps
    wh = warped.shape[0] * warped.shape[1]
    if wh < 20_000:
        return None
    return warped


def _propose_pill_region(img_bgr: np.ndarray) -> np.ndarray | None:
    # Heuristic: find a large smooth blob (pill) and crop it.
    gray = _to_gray(img_bgr)
    gray = cv2.GaussianBlur(gray, (7, 7), 0)

    # Use Otsu; pills often have clear boundary vs background.
    thr = _otsu(gray)
    # Ensure foreground is white (largest blob).
    if thr.mean() > 127:
        thr = cv2.bitwise_not(thr)

    thr = cv2.morphologyEx(thr, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8), iterations=1)
    thr = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=1)

    cnts, _ = cv2.findContours(thr, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None

    h, w = gray.shape[:2]
    img_area = float(h * w)

    best = None
    best_score = 0.0

    for c in cnts:
        area = float(cv2.contourArea(c))
        if area < img_area * 0.03 or area > img_area * 0.80:
            continue

        peri = float(cv2.arcLength(c, True))
        if peri <= 0:
            continue
        circularity = 4.0 * np.pi * area / (peri * peri)

        x, y, bw, bh = cv2.boundingRect(c)
        aspect = float(bw) / float(bh) if bh else 999.0

        # Pills tend to be near-circular/oval; accept a wide band.
        shape_score = 0.0
        shape_score += max(0.0, 1.0 - abs(1.0 - aspect))  # closer to 1 is better
        shape_score += min(1.0, circularity)  # 0..1

        score = (area / img_area) * 2.0 + shape_score
        if score > best_score:
            best_score = score
            best = (x, y, bw, bh)

    if best is None:
        return None

    x, y, bw, bh = best
    pad = int(round(max(bw, bh) * 0.12))
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(w, x + bw + pad)
    y1 = min(h, y + bh + pad)

    crop = img_bgr[y0:y1, x0:x1]
    if crop.size < 20_000:
        return None
    return crop


def _propose_text_block_region(img_bgr: np.ndarray) -> np.ndarray | None:
    """Heuristic crop for dense text blocks (helps packaging/labels).

    Uses morphology to group horizontal text strokes into rectangular regions.
    """

    gray = _to_gray(img_bgr)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    # Emphasize horizontal gradients (text lines)
    grad_x = cv2.Sobel(gray, ddepth=cv2.CV_32F, dx=1, dy=0, ksize=3)
    grad_x = np.absolute(grad_x)
    grad_x = np.uint8(np.clip(grad_x, 0, 255))

    # Help type checkers: ensure ndarray input for cv2.threshold
    grad_x_u8 = np.asarray(grad_x, dtype=np.uint8)
    _, bw = cv2.threshold(grad_x_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Close gaps between characters/words
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 5))
    closed = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kernel, iterations=2)
    closed = cv2.morphologyEx(closed, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)

    cnts, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None

    h, w = gray.shape[:2]
    img_area = float(h * w)

    best = None
    best_score = 0.0

    for c in cnts:
        x, y, bw2, bh2 = cv2.boundingRect(c)
        area = float(bw2 * bh2)
        if area < img_area * 0.05:
            continue
        if bw2 < w * 0.25:
            continue
        aspect = float(bw2) / float(bh2) if bh2 else 999.0
        # Prefer wide-ish regions typical for label text lines/blocks
        score = (area / img_area) + min(2.5, aspect / 4.0)
        if score > best_score:
            best_score = score
            best = (x, y, bw2, bh2)

    if best is None:
        return None

    x, y, bw2, bh2 = best
    pad = int(round(max(bw2, bh2) * 0.08))
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(w, x + bw2 + pad)
    y1 = min(h, y + bh2 + pad)

    crop = img_bgr[y0:y1, x0:x1]
    if crop.size < 20_000:
        return None
    return crop


def _propose_regions(img_bgr: np.ndarray) -> list[tuple[str, np.ndarray]]:
    regions: list[tuple[str, np.ndarray]] = [("full", img_bgr)]

    # Center crop helps when background is noisy.
    h, w = img_bgr.shape[:2]
    cx0 = int(w * 0.2)
    cx1 = int(w * 0.8)
    cy0 = int(h * 0.2)
    cy1 = int(h * 0.8)
    center = img_bgr[cy0:cy1, cx0:cx1]
    if center.size > 10_000:
        regions.append(("center", center))

    box = _propose_box_region(img_bgr)
    if box is not None:
        regions.append(("box_warp", box))

    text_block = _propose_text_block_region(img_bgr)
    if text_block is not None:
        regions.append(("text_block", text_block))

    pill = _propose_pill_region(img_bgr)
    if pill is not None:
        regions.append(("pill_crop", pill))

    # De-dup by shape
    uniq: list[tuple[str, np.ndarray]] = []
    seen = set()
    for name, r in regions:
        key = (name, int(r.shape[0]), int(r.shape[1]))
        if key in seen:
            continue
        seen.add(key)
        uniq.append((name, r))

    return uniq


def _order_regions(regions: list[tuple[str, np.ndarray]], mode: str) -> list[tuple[str, np.ndarray]]:
    m = str(mode or "auto").strip().lower()
    if m not in {"auto", "box", "pill"}:
        m = "auto"

    rank_auto = {"box_warp": 0, "text_block": 1, "pill_crop": 2, "center": 3, "full": 4}
    rank_box = {"box_warp": 0, "text_block": 1, "center": 2, "full": 3, "pill_crop": 4}
    rank_pill = {"pill_crop": 0, "center": 1, "full": 2, "box_warp": 3, "text_block": 4}
    rank = rank_auto if m == "auto" else (rank_box if m == "box" else rank_pill)

    return sorted(regions, key=lambda x: rank.get(x[0], 99))


def _score_ocr_results(results: Iterable[object]) -> tuple[float, str]:
    texts: list[str] = []
    score = 0.0
    count = 0

    for item in results:
        if not isinstance(item, (tuple, list)) or len(item) < 3:
            continue
        _bbox, text, conf = item[0], item[1], item[2]
        t = str(text or "").strip()
        if not t:
            continue
        # Ignore single-character noise unless it's clearly confident.
        if len(t) < 2 and float(conf or 0.0) < 0.85:
            continue

        c = float(conf or 0.0)
        texts.append(t)
        score += c
        count += 1

    # Encourage having more high-confidence tokens.
    score += min(3.0, count * 0.15)

    return score, " ".join(texts).strip()


def run_ocr_best_effort(
    raw_image_bytes: bytes,
    *,
    mode: str = "auto",
    max_total_runs: int = 18,
) -> tuple[str, list[OcrAttempt], dict[str, str]]:
    """Run multi-pass OCR and pick best attempt.

    Returns (best_text, attempts_sorted_desc).
    """

    img = _safe_imdecode(raw_image_bytes)
    img = _resize_max_side(img, 1600)

    attempts: list[OcrAttempt] = []

    regions = _order_regions(_propose_regions(img), mode)

    total_runs = 0
    for region_name, region_img in regions:
        # Per-region mode: if we already isolated a pill crop, treat it as pill; box regions get box tuning.
        region_mode = (
            "pill"
            if region_name == "pill_crop"
            else ("box" if region_name in {"box_warp", "text_block"} else mode)
        )
        variants = _preprocess_variants(region_img, mode=region_mode)

        # Cap per-region variants to keep runtime bounded.
        for variant_name, pre in variants[:6]:
            if total_runs >= max_total_runs:
                break

            try:
                raw = ocr_reader_with_boxes(pre)
                s, text = _score_ocr_results(raw)
            except Exception:
                s, text = 0.0, ""

            attempts.append(OcrAttempt(region=region_name, variant=variant_name, score=float(s), text=text))
            total_runs += 1

        if total_runs >= max_total_runs:
            break

    attempts.sort(key=lambda a: a.score, reverse=True)

    best_by_region: dict[str, OcrAttempt] = {}
    for a in attempts:
        if a.region not in best_by_region:
            best_by_region[a.region] = a

    # Prefer explicit regions when present.
    best_box = best_by_region.get("box_warp")
    best_pill = best_by_region.get("pill_crop")
    best_center = best_by_region.get("center")
    best_full = best_by_region.get("full")

    box_text = (best_box.text if best_box else (best_center.text if best_center else ""))
    pill_text = (best_pill.text if best_pill else "")
    full_text = (best_full.text if best_full else "")

    best_text = _dedup_merge_texts([box_text, pill_text, full_text])

    # Fallback: if best is empty, try a single direct call on grayscale
    if not best_text:
        try:
            gray = _to_gray(img)
            raw = ocr_reader_with_boxes(gray)
            s, text = _score_ocr_results(raw)
            attempts.append(OcrAttempt(region="full", variant="gray_direct", score=float(s), text=text))
            attempts.sort(key=lambda a: a.score, reverse=True)
            if not best_text:
                best_text = attempts[0].text if attempts else ""
        except Exception:
            pass

    texts = {
        "ocr_text": (best_text or "").strip(),
        "ocr_text_box": (box_text or "").strip(),
        "ocr_text_pill": (pill_text or "").strip(),
    }
    return (texts["ocr_text"] or "").strip(), attempts, texts
