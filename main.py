import ssl
ssl._create_default_https_context = ssl._create_unverified_context

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
from src.engine import SearchEngine
from src.database import PillDatabase
from src.analyzer import MedicineAnalyzer
from src.rag import RAGEngine

app = FastAPI(title="Medicine Identification API")

# CORS 설정 (React 앱에서 접근 가능하도록)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 초기화
db = PillDatabase("data/pill_db.json")
rag_engine = RAGEngine(db)
engine = SearchEngine(db, rag_engine)

@app.get("/")
async def root():
    return {"message": "Medicine Identification API is running"}

@app.post("/identify-pill")
async def identify_pill(file: UploadFile = File(...)):
    """
    이미지를 업로드하면 OCR로 텍스트를 추출하고
    RAG를 사용하여 의약품 정보를 생성합니다.
    """
    temp_path = None
    try:
        # 이미지 파일 확인
        if not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="이미지 파일만 업로드 가능합니다.")
        
        # 임시 저장
        os.makedirs("temp", exist_ok=True)
        temp_path = f"temp/{file.filename}"
        
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # OCR + RAG 처리
        result = engine.run_process(temp_path)
        
        return {
            "success": True,
            "data": result
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"처리 중 오류 발생: {str(e)}")
    
    finally:
        # 임시 파일 삭제
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/get-usage-info")
async def get_usage_info(medicine_info: dict):
    """
    식별된 의약품 정보를 받아서 복용 방법과 주의사항에 특화된 정보를 제공합니다.
    """
    try:
        # 의약품 정보 추출
        medicine_data = medicine_info.get("medicine", {})
        
        if not medicine_data:
            raise HTTPException(status_code=400, detail="의약품 정보가 필요합니다.")
        
        # 복용 정보 및 주의사항에 특화된 RAG 쿼리
        result = rag_engine.generate_usage_guide(medicine_data)
        
        return {
            "success": True,
            "data": result
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"정보 생성 중 오류 발생: {str(e)}")

@app.post("/ask-about-medicine")
async def ask_about_medicine(request: dict):
    """
    의약품 정보와 사용자의 질문을 받아 맞춤형 답변을 제공합니다.
    """
    try:
        medicine_data = request.get("medicine", {})
        user_question = request.get("question", "")
        
        if not medicine_data:
            raise HTTPException(status_code=400, detail="의약품 정보가 필요합니다.")
        
        if not user_question:
            raise HTTPException(status_code=400, detail="질문을 입력해주세요.")
        
        # 사용자 질문에 맞춤형 답변 생성
        result = rag_engine.answer_question(medicine_data, user_question)
        
        return {
            "success": True,
            "data": result
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"답변 생성 중 오류 발생: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
