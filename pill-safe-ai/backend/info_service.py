import os
from typing import Optional

import pandas as pd

try:
    import pyttsx3
except Exception:  # optional dependency / platform-specific
    pyttsx3 = None

class PillInfoService:
    def __init__(self, pkl_path=r"D:\Data\pill_db.pkl"):
        print("🎙️ 서비스 엔진을 초기화합니다...")
        self.tts_available = pyttsx3 is not None

        # 파일이 없으면 기본적으로 실데이터 미구성 상태로 동작(샘플 노출 방지)
        if not os.path.exists(pkl_path):
            allow_demo = str(os.getenv("ALLOW_DEMO_DATA", "")).strip().lower() in ("1", "true", "yes", "on")
            if allow_demo:
                print(f"⚠️ '{pkl_path}' 파일이 없어 데모 DB로 실행합니다. (ALLOW_DEMO_DATA 활성화)")
                self.df = self._build_demo_df(target_size=120)
            else:
                print(f"⚠️ '{pkl_path}' 파일이 없습니다. 샘플 노출을 방지하기 위해 검색은 비활성화됩니다.")
                self.df = pd.DataFrame()
            return

        self.df = pd.read_pickle(pkl_path)
        print(f"✅ DB 로드 완료: {len(self.df)}개의 약품 정보가 준비되었습니다.")

    def _build_demo_df(self, target_size: int = 100) -> pd.DataFrame:
        seed_rows = [
            {
                "품목명": "타이레놀정 500mg",
                "업체명": "한국존슨앤드존슨",
                "주성분": "아세트아미노펜",
                "전문일반구분": "일반의약품",
            },
            {
                "품목명": "부루펜정",
                "업체명": "삼일제약",
                "주성분": "이부프로펜",
                "전문일반구분": "일반의약품",
            },
            {
                "품목명": "지르텍정",
                "업체명": "유한양행",
                "주성분": "세티리진",
                "전문일반구분": "일반의약품",
            },
            {
                "품목명": "판콜에이내복액",
                "업체명": "동화약품",
                "주성분": "복합감기성분",
                "전문일반구분": "일반의약품",
            },
            {
                "품목명": "겔포스엠현탁액",
                "업체명": "보령",
                "주성분": "알루미늄/마그네슘",
                "전문일반구분": "일반의약품",
            },
        ]

        companies = [
            "유한양행",
            "종근당",
            "한미약품",
            "대웅제약",
            "동아제약",
            "보령",
            "삼일제약",
            "광동제약",
            "일동제약",
        ]
        ingredients = [
            "아세트아미노펜",
            "이부프로펜",
            "나프록센",
            "로라타딘",
            "세티리진",
            "푸세미드",
            "오메프라졸",
            "판토프라졸",
            "암로디핀",
            "로수바스타틴",
        ]
        categories = ["일반의약품", "전문의약품"]

        rows = list(seed_rows)
        # 임시 UI/테스트용: 현실적인 형태의 더미 100개 이상 생성
        i = 1
        while len(rows) < max(5, int(target_size)):
            company = companies[(i - 1) % len(companies)]
            ingredient = ingredients[(i - 1) % len(ingredients)]
            category = categories[(i - 1) % len(categories)]
            dosage = "500mg" if (i % 3 == 0) else ("200mg" if (i % 3 == 1) else "10mg")
            rows.append(
                {
                    "품목명": f"데모약품 {i:03d} {dosage}",
                    "업체명": company,
                    "주성분": ingredient,
                    "전문일반구분": category,
                }
            )
            i += 1

        return pd.DataFrame(rows)

    def list_items(self, limit: int = 100, query: Optional[str] = None):
        if self.df is None or self.df.empty:
            return []

        limit = max(1, min(int(limit or 100), 500))
        search_col = '품목명' if '품목명' in self.df.columns else self.df.columns[0]

        df = self.df
        if query:
            q = str(query).strip()
            if q:
                df = df[df[search_col].astype(str).str.contains(q, na=False, case=False)]

        df = df.head(limit)
        items = []
        for _, item in df.iterrows():
            items.append(
                {
                    "제품명": str(item.get(search_col, "이름 없음")),
                    "업체명": str(item.get("업체명", "업체 없음")),
                    "성분": str(item.get("주성분", "성분 없음")),
                    "분류": str(item.get("전문일반구분", "분류 없음")),
                }
            )
        return items

    def search_and_announce(self, query):
        if self.df is None or self.df.empty:
            return None

        search_col = '품목명' if '품목명' in self.df.columns else self.df.columns[0]
        # 부분 일치 검색
        results = self.df[self.df[search_col].str.contains(query, na=False, case=False)]

        if not results.empty:
            item = results.iloc[0]
            res = {
                "제품명": str(item.get(search_col, "이름 없음")),
                "업체명": str(item.get("업체명", "업체 없음")),
                "성분": str(item.get("주성분", "성분 없음")),
                "분류": str(item.get("전문일반구분", "분류 없음"))
            }

            # [핵심] Flask 환경에서 목소리 꼬임 방지를 위해 로컬 엔진 사용
            try:
                if pyttsx3 is None:
                    raise RuntimeError("pyttsx3 not installed")

                engine = pyttsx3.init()
                # 여성 목소리 설정
                voices = engine.getProperty('voices')
                for voice in voices:
                    if 'Korean' in voice.name or 'Heami' in voice.name:
                        engine.setProperty('voice', voice.id)
                        break
                
                text = f"검색하신 약은 {res['제품명']}입니다."
                print(f"🔊 음성 출력: {text}")
                
                engine.say(text)
                engine.runAndWait()
                engine.stop() # 엔진 자원 반납
            except Exception as e:
                print(f"⚠️ TTS 엔진 에러 (무시하고 데이터만 반환): {e}")
            
            return res
        return None

if __name__ == "__main__":
    # 테스트 코드
    try:
        service = PillInfoService()
        service.search_and_announce("타이레놀")
    except Exception as e:
        print(e)