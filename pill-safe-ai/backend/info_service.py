import pandas as pd
import os
import pyttsx3

class PillInfoService:
    def __init__(self, pkl_path=r"D:\Data\pill_db.pkl"):
        print("🎙️ 서비스 엔진을 초기화합니다...")
        # 파일 존재 여부를 체크하여 친절한 에러 메시지 출력
        if not os.path.exists(pkl_path):
            raise FileNotFoundError(f"❌ '{pkl_path}' 파일을 찾을 수 없습니다. data_manager.py를 먼저 실행하세요!")
        
        self.df = pd.read_pickle(pkl_path)
        print(f"✅ DB 로드 완료: {len(self.df)}개의 약품 정보가 준비되었습니다.")

    def search_and_announce(self, query):
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