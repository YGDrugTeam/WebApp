import pyttsx3

def announce_pill_info(info):
    if not info:
        return
    
    engine = pyttsx3.init()
    voices = engine.getProperty('voices')
    
    # 여성 목소리 설정
    for voice in voices:
        if 'Korean' in voice.name or 'Heami' in voice.name:
            engine.setProperty('voice', voice.id)
            break
        
    # [문제 4] 안내 멘트를 구성해 보세요.
    # (제품명, 업체명, 성분을 사용하여 신뢰감 있는 문장을 만듭니다.)
    message = f"인식된 약은 {info['제품명']}입니다. {info['업체명']} 제품이며, 성분은 {info['성분']}입니다."
    
    engine.setProperty('rate', 165)
    engine.say(message)
    engine.runAndWait()