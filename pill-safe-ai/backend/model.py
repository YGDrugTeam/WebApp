import io
import numpy as np
import cv2
import easyocr

# AI 엔진을 미리 로드해둡니다(처음에 한 번만!)
reader = easyocr.Reader(['ko', 'en'])

def ocr_reader(img):
    # 이미지에서 글자를 읽어냅니다.
    results = reader.readtext(img)

    # 읽어낸 글자들만 모아서 돌려줍니다.
    text_list = [res[1] for res in results]
    return " ".join(text_list)


def ocr_reader_with_boxes(img):
    """Return EasyOCR raw results: [(bbox, text, confidence), ...]."""
    return reader.readtext(img)