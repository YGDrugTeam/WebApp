import model
import numpy as np
import cv2
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

@app.post("/analyze")
async def analyze_pill(file: UploadFile = File(...)):    
    contents = await file.read()

    # analyze_pill 함수 안에서 추가될 내용
    image_bytes = np.frombuffer(contents, np.uint8) 
    img = cv2.imdecode(image_bytes, cv2.IMREAD_COLOR)
    
    return {
        "filename": file.filename,
        "size": len(contents), # 파일 크기(byte)
        "message": "AI가 이미지를 확인했습니다!",
        "detected_text": "알약 이름을 읽는 중...", # 여기에 결과가 담길 예정입니다.
        "pill_name": ai_result
    }

app.add_middleware(
    CORSMiddleware, # 가져온 미들웨어 클래스 이름
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

result = model.ocr_reader(img)