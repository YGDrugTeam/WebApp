import io
import numpy as np
import cv2
import easyocr
import os

try:
    import torch
except Exception:  # pragma: no cover
    torch = None

def _bool_env(name: str) -> bool | None:
    raw = os.getenv(name, "").strip().lower()
    if raw in {"1", "true", "yes", "y", "on"}:
        return True
    if raw in {"0", "false", "no", "n", "off"}:
        return False
    return None


def _detect_ocr_gpu() -> tuple[bool, str]:
    forced = _bool_env("OCR_USE_GPU")
    if forced is False:
        return False, "disabled_by_env"

    if torch is None:
        return False, "torch_not_available"

    try:
        if not bool(torch.cuda.is_available()):
            return False, "cuda_not_available"

        # Some setups report CUDA as available, but kernels cannot actually run
        # (e.g., GPU compute capability not supported by the installed wheel).
        try:
            x = torch.randn((1,), device="cuda")
            y = x * 2
            _ = float(y.sum().item())
        except Exception:
            if forced is True:
                return False, "forced_but_cuda_unusable"
            return False, "cuda_unusable"

        return True, "cuda_available" if forced is None else "forced_by_env"
    except Exception:
        return False, "cuda_check_failed"


# AI 엔진을 미리 로드해둡니다(처음에 한 번만!)
OCR_GPU_ENABLED, OCR_GPU_REASON = _detect_ocr_gpu()

try:
    reader = easyocr.Reader(['ko', 'en'], gpu=OCR_GPU_ENABLED)
except Exception:
    # Fallback to CPU if GPU init fails (e.g., torch CPU wheel installed)
    OCR_GPU_ENABLED = False
    OCR_GPU_REASON = "easyocr_gpu_init_failed_fallback_cpu"
    reader = easyocr.Reader(['ko', 'en'], gpu=False)

def ocr_reader(img):
    # 이미지에서 글자를 읽어냅니다.
    results = reader.readtext(img)

    # 읽어낸 글자들만 모아서 돌려줍니다.
    text_list = [res[1] for res in results]
    return " ".join(text_list)


def ocr_reader_with_boxes(img):
    """Return EasyOCR raw results: [(bbox, text, confidence), ...]."""
    return reader.readtext(img)