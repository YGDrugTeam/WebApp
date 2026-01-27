import pandas as pd
import os

def search_pill_from_excel(pill_name):
    """
    엑셀 파일들을 순회하며 약품 상세 정보를 검색합니다.
    """
    base_path = "D:\\다운로드\\의약품등제품정보목록.xlsx"
    result_info = None
    
    # 10개의 엑셀 파일(Sheet0.xlsx ~ Sheet9.xlsx)이 있다고 가정합니다.
    for i in range(10): # (1) 0~9까지 숫자를 생성하는 함수
        file_name = f"의약품등제품정보목록_Sheet{i}.xlsx"
        file_path = os.path.join(base_path, file_name)
        
        if not os.path.exists(file_path):
            continue
        
        # [중요] 엑셀 파일을 읽을 때는 엔진 설정이 성능에 큰 영향을 줍니다.
        # (2) Pandas에서 엑셀을 읽을 때 사용하는 함수와 엔진(engine)을 완성하세요.
        df = pd.read_excel(file_path, engine='openpyxl')
        
        # (3) '품목명' 컬럼에서 pill_name을 포함하거나 일치하는 행을 필터링하세요.
        # 중급자 팁: 정확히 일치하는 것보다 '포함'하는 것을 찾을 때는 .str.contains()를 쓰기도 합니다.
        target_row = df[df['품목명'] == pill_name]
        
        # (4) 결과가 비어있는지 확인하는 조건문(Pandas 객체의 속성 활용)
        if not target_row.empty:
            # (5) 행 번호가 아닌 '순서'로 첫 번째 데이터를 가져오는 함수
            found_data = target_row.iloc[0].to_dict()
            
            result_info = {
                "제품명": found_data.get("품목명"),
                "업체명": found_data.get("업체명"),
                "성분": found_data.get("주성분"),
                "분류": found_data.get("전문일반구분")
            }
            
            # (6) 찾았으니 가장 가까운 반복문을 즉시 중단합니다.
            break
            
    return result_info

# 실행 테스트
if __name__ == "__main__":
    sample_pill = "타이레놀정500mg"
    info = search_pill_from_excel(sample_pill)
    
    if info:
        print(f"✨ 정보를 찾았습니다: {info['제품명']} / 제조사: {info['업체명']}")
    else:
        print("🔍 엑셀 파일 내에 해당 약품 정보가 없습니다.")