import pandas as pd
import os

def build_pill_database():
    file_path = "D:\\Data\\의약품등제품정보목록.xlsx"
    save_path = "D:\\Data\\pill_db.pkl"
    cols = ["제품명", "업체명", "주성분", "품목구분"]

    if not os.path.exists(file_path):
        print("🛑 파일을 찾을 수 없습니다.")
        return

    print("🚀 대용량 엑셀 최적화 모드로 통합을 시작합니다...")

    try:
        # [문제 1] sheet_name에 None을 넣으면 모든 시트를 '딕셔너리' 형태로 한 번에 읽어옵니다.
        # 이렇게 하면 파일을 여러 번 여는 오버헤드를 줄일 수 있습니다.
        all_sheets = pd.read_excel(file_path, engine='openpyxl', sheet_name=None, usecols=cols)
        
        # [문제 2] all_sheets는 {시트명: 데이터프레임} 형태의 딕셔너리입니다.
        # 이 딕셔너리의 '값(Value)'들만 모아서 리스트로 만드세요.
        sheet_list = list(all_sheets.values())
        
        print(f"✅ {len(sheet_list)}개의 시트 로드 완료. 결합 중...")

        # [문제 3] 리스트에 담긴 데이터프레임들을 하나로 합칩니다.
        final_df = pd.concat(sheet_list, ignore_index=True)

        # [문제 4] 검색 효율을 위해 피클로 저장합니다.
        final_df.to_pickle(save_path)
        
        print(f"✨ 완성! 총 {len(final_df)}행의 데이터가 준비되었습니다.")

    except Exception as e:
        print(f"❌ 에러 발생: {e}")

if __name__ == "__main__":
    build_pill_database()