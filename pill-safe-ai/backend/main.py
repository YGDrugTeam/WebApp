import os
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

import model
import numpy as np
import cv2
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1. 메인 페이지 접속 시 메시지가 나오도록 수정
@app.get("/")
def read_root():
    return {
        "status": "running", 
        "message": "Pill-Safe AI Backend is active!",
        "docs_url": "/docs"  # 문서로 바로 갈 수 있는 힌트 제공
    }

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.post("/analyze")
async def analyze_pill(file: UploadFile = File(...)):    
    contents = await file.read()

    image_bytes = np.frombuffer(contents, np.uint8) 
    img = cv2.imdecode(image_bytes, cv2.IMREAD_COLOR)
    
    # model.py의 ocr_reader 함수 호출
    result = model.ocr_reader(img)

    return {
        "filename": file.filename,
        "size": len(contents),
        "message": "AI가 이미지를 확인했습니다!",
        "pill_name": result  # 실제 OCR 결과가 여기에 담깁니다.
    }

if __name__ == "__main__":
    import uvicorn
    import webbrowser
    # 서버 시작 직후 브라우저를 열어줌
    webbrowser.open("http://127.0.0.1:8000/docs") 
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)