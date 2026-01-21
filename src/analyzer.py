import torch
import cv2
import easyocr
import numpy as np
from torchvision import models, transforms

class MedicineAnalyzer:
    """
    알약 이미지 분석기
    - OCR로 텍스트 추출
    - 색상, 모양 특징 추출
    """
    
    def __init__(self):
        print("[분석기 초기화 중...]")
        # OCR 리더 초기화 (한국어, 영어 지원)
        self.ocr_reader = easyocr.Reader(['en', 'ko'], gpu=torch.cuda.is_available())
        
        # 이미지 분류 모델 로드
        self.image_model = self._load_model()
        print("[분석기 초기화 완료]")

    def _load_model(self):
        """ResNet50 모델 로드"""
        resnet = models.resnet50(pretrained=True)
        return torch.nn.Sequential(*list(resnet.children())[:-1]).eval()

    def analyze(self, image_path):
        """
        이미지에서 특징을 추출합니다.
        """
        try:
            # 이미지 읽기
            image = cv2.imread(image_path)
            if image is None:
                raise ValueError(f"이미지를 읽을 수 없습니다: {image_path}")
            
            # 1. OCR로 텍스트 추출
            text = self._extract_text(image)
            
            # 2. 색상 추출
            color = self._extract_color(image)
            
            # 3. 모양 추출
            shape = self._extract_shape(image)
            
            print(f"[분석 완료] 텍스트: {text}, 색상: {color}, 모양: {shape}")
            
            return {
                "text": text,
                "color": color,
                "shape": shape
            }
        
        except Exception as e:
            print(f"[분석 오류] {e}")
            return {
                "text": "",
                "color": "unknown",
                "shape": "unknown",
                "error": str(e)
            }

    def _extract_text(self, image):
        """
        EasyOCR로 이미지에서 텍스트 추출
        """
        # 이미지 전처리 (그레이스케일, 대비 향상)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        enhanced = cv2.equalizeHist(gray)
        
        # OCR 실행
        results = self.ocr_reader.readtext(enhanced)
        
        # 결과에서 텍스트만 추출하고 합치기
        texts = [text for (bbox, text, prob) in results if prob > 0.3]
        
        return " ".join(texts).strip()

    def _extract_color(self, image):
        """
        이미지의 주요 색상 추출
        """
        # 이미지를 HSV로 변환
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        
        # 중앙 영역의 평균 색상 계산
        h, w = image.shape[:2]
        center_region = hsv[h//4:3*h//4, w//4:3*w//4]
        avg_color = np.mean(center_region, axis=(0, 1))
        
        # HSV 값을 색상명으로 변환
        hue = avg_color[0]
        
        if hue < 15 or hue > 165:
            return "red"
        elif hue < 30:
            return "orange"
        elif hue < 75:
            return "yellow"
        elif hue < 150:
            return "green"
        else:
            return "white"

    def _extract_shape(self, image):
        """
        알약의 모양 추출 (원형, 타원형, 사각형 등)
        """
        # 그레이스케일 변환
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # 블러 처리
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # 엣지 검출
        edges = cv2.Canny(blurred, 50, 150)
        
        # 윤곽선 찾기
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            return "unknown"
        
        # 가장 큰 윤곽선 선택
        largest_contour = max(contours, key=cv2.contourArea)
        
        # 근사 다각형으로 변환
        epsilon = 0.04 * cv2.arcLength(largest_contour, True)
        approx = cv2.approxPolyDP(largest_contour, epsilon, True)
        
        # 꼭짓점 개수로 모양 판단
        vertices = len(approx)
        
        if vertices < 6:
            return "rectangular"
        elif vertices < 10:
            return "hexagonal"
        else:
            # 원형도 계산
            area = cv2.contourArea(largest_contour)
            perimeter = cv2.arcLength(largest_contour, True)
            if perimeter == 0:
                return "unknown"
            circularity = 4 * np.pi * area / (perimeter ** 2)
            
            if circularity > 0.85:
                return "round"
            else:
                return "oval"
