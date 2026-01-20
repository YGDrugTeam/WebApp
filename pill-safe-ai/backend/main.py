from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import cv2

# analyze_pill 함수 안에서 추가될 내용
image_bytes = np.frombuffer(contents, np.uint8)
img = cv2.imdecode(image_bytes, cv2.IMREAD_COLOR)

app = FastAPI()

@app.post("/analyze")
async def analyze_pill(file: UploadFile = File(...)):    
    contents = await file.read()
    return {
        "filename": file.filename,
        "size": len(contents), # 파일 크기(byte)
        "message": "분석 준비 완료"
    }

app.add_middleware(
    CORSMiddleware, # 가져온 미들웨어 클래스 이름
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)
    