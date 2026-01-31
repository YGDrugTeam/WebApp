import pandas as pd

def split_by_missing(xlsx_path, save_path_no_missing, save_path_nan):
    df = pd.read_excel(xlsx_path)
    # 결측치가 있는 행 모두 삭제
    df_no_missing = df.dropna()
    df_no_missing.to_excel(save_path_no_missing, index=False)
    # 결측치가 있는 행만 NaN으로 표시
    df_nan = df.copy()
    df_nan[df_nan.isnull().any(axis=1)] = float('nan')
    df_nan.to_excel(save_path_nan, index=False)

if __name__ == "__main__":
    split_by_missing(
        "backend/data/pharmacies_seoul_utf8_filled.xlsx",
        "backend/data/pharmacies_seoul_utf8_filled_no_missing.xlsx",
        "backend/data/pharmacies_seoul_utf8_filled_nan_only.xlsx"
    )
