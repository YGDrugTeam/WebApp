import requests
import pandas as pd
import time

def get_kakao_place_info(query, address=None):
    """
    카카오맵 장소 검색 API를 사용해 약국명+주소로 전화번호, 좌표, 도로명주소, 우편번호 등 추출
    (공식 API가 아니므로, 실제 서비스에서는 REST API Key 필요)
    """
    REST_API_KEY = "a63ed4b673d5da14db60a30671926e4a"  # 실제 키로 교체 필요
    headers = {"Authorization": f"KakaoAK {REST_API_KEY}"}
    params = {"query": query}
    if address:
        params["query"] = f"{query} {address}"
    url = "https://dapi.kakao.com/v2/local/search/keyword.json"
    resp = requests.get(url, headers=headers, params=params)
    if resp.status_code != 200:
        return None
    data = resp.json()
    if data.get("documents"):
        doc = data["documents"][0]
        return {
            "place_name": doc.get("place_name"),
            "address_name": doc.get("address_name"),
            "road_address_name": doc.get("road_address_name"),
            "phone": doc.get("phone"),
            "x": doc.get("x"),
            "y": doc.get("y"),
        }
    return None

def fill_missing_info(xlsx_path, save_path):
    df = pd.read_excel(xlsx_path)
    for idx, row in df[df.isnull().any(axis=1)].iterrows():
        name = row.get("사업장명")
        addr = row.get("도로명주소")
        if pd.isnull(name):
            continue
        info = get_kakao_place_info(name, addr)
        if info:
            if pd.isnull(row.get("전화번호")) and info.get("phone"):
                df.at[idx, "전화번호"] = info["phone"]
            if pd.isnull(row.get("도로명주소")) and info.get("road_address_name"):
                df.at[idx, "도로명주소"] = info["road_address_name"]
            if pd.isnull(row.get("좌표정보(X)")) and info.get("x"):
                df.at[idx, "좌표정보(X)"] = info["x"]
            if pd.isnull(row.get("좌표정보(Y)")) and info.get("y"):
                df.at[idx, "좌표정보(Y)"] = info["y"]
        time.sleep(0.5)  # API rate limit 대응
    df.to_excel(save_path, index=False)

if __name__ == "__main__":
    fill_missing_info(
        "backend/data/pharmacies_seoul_utf8_business_only_cleaned.xlsx",
        "backend/data/pharmacies_seoul_utf8_filled.xlsx"
    )
