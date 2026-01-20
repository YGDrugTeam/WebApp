from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

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
    