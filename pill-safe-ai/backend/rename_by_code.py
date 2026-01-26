import os
import pandas as pd
from tqdm import tqdm

def rename_pills_folders_from_excel(base_path, excel_path):
    """
    엑셀의 모든 시트를 읽어 품목기준코드를 약 이름으로 매핑하고 폴더명을 변경합니다.
    """
    print("엑셀 파일을 읽는 중입니다. 모든 시트를 통합합니다...")
    
    
    # 1. 엑셀의 모든 시트를 읽기(sheet_name=Name으로 설정하면 모든 시트를 dict 형태로 가져옴) 
    all_sheets = pd.read_excel(excel_path, sheet_name=None)
    
    combined_mapping = {}
    
    for sheet_name, df in all_sheets.items():
        print(f"시트 처리 중: {sheet_name}")
        # 컬럼명이 '품목기준코드', '제품명'인지 확인(업로드한 파일 기준)
        if '품목기준코드' in df.columns and '제품명' in df.columns:
            # 품목기준코드를 키로, 제품명을 값으로 딕셔너리 생성 및 업데이트
            sheet_mapping = dict(zip(df['품목기준코드'].astype(str), df['제품명'].astype(str)))
            combined_mapping.update(sheet_mapping)
            
    print(f"총 {len(combined_mapping)}개의 약품 정보가 로드되었습니다.")
    
    # 2. 폴더 변경 작업
    if not os.path.exists(base_path):
        print(f"경로를 찾을 수 없습니다: {base_path}")
        return
    
    folders = [f for f in os.listdir(base_path) if os.path.isdir(os.path.join(base_path, f))]
    print(f"대상 폴더 수: {len(folders)}개")
    
    success_count = 0
    missing_count = 0
    
    for folder in tqdm(folders):
        # 폴더명이 숫자 코드로만 되어 있을 경우 매핑 확인
        if folder in combined_mapping:
            pill_name = combined_mapping[folder]
            
            # 파일명 규칙에 어긋나는 특수문자 제거
            clean_name = "".join([c for c in pill_name if c.isalnum() or c in (' ', '_', '-')]).strip()
            
            old_path = os.path.join(base_path, folder)
            new_path = os.path.join(base_path, f"{folder}_{clean_name}")
            
            if not os.path.exists(new_path):
                try:
                    os.rename(old_path, new_path)
                    success_count += 1
                except Exception as e:
                    print(f"변경 실패 ({folder}): {e}")
        else:
            missing_count += 1
            with open("missing_codes.log", "a", encoding="utf-8") as log:
                log.write(f"코드 없음: {folder}\n")
    
    print(f"\n작업 완료!")
    print(f"성공: {success_count}개 | 정보 없음: {missing_count}개")
    
if __name__ == "__main__":
    # 1. 엑셀 엔진을 위해  openpyxl 설치가 필요할 수 있습니다. pip install openpyxl
    BASE_DIR = 'D:\\Data\\pre_trained' # 실제 이미지가 들어있는 경로
    EXCEL_FILE = "D:\\다운로드\\의약품등제품정보목록.xlsx" # 엑셀 파일 경로
    
    rename_pills_folders_from_excel(BASE_DIR, EXCEL_FILE)