import pickle
import os

# 1. 샘플 데이터 생성 (실제 Pharmacy 객체 구조가 필요할 수 있지만, 우선 기본 리스트로 시도)
sample_data = [
    {
        "name": "테스트 약국",
        "address": "서울시 강남구 역삼동",
        "tel": "02-123-4567",
        "lat": 37.4979,
        "lon": 127.0276
    },
    {
        "name": "희망 약국",
        "address": "서울시 서초구 서초동",
        "tel": "02-987-6543",
        "lat": 37.4879,
        "lon": 127.0176
    }
]

# 2. 파일 저장 경로 설정 (현재 폴더)
file_name = "pill_db.pkl"

try:
    with open(file_name, "wb") as f:
        pickle.dump(sample_data, f)
    print(f"✅ {file_name} 파일이 성공적으로 생성되었습니다!")
    print(f"경로: {os.path.abspath(file_name)}")
except Exception as e:
    print(f"❌ 파일 생성 중 에러 발생: {e}")