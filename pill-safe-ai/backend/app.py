from flask import Flask, request, jsonify
from flask_cors import CORS
from info_service import PillInfoService

app = Flask(__name__)
# [문제 1] 보안 정책상 다른 도메인(웹페이지)에서 서버에 접근할 수 있게 허용해주는 설정은?
CORS(app)

# 검색 서비스 초기화
info_service = PillInfoService()

# [문제 2] 사용자가 'http://localhost:5000/search?name=타이레놀'로 요청을 보낼 때
# 사용할 HTTP 메서드와 경로를 정의하는 데코레이터를 완성하세요.
@app.route('/search', methods=['GET'])
def search_pill():
    try:
        pill_name = request.args.get('name')
        result = info_service.search_and_announce(pill_name)

        if result:
            return jsonify({"status": "success", "data": result})
        return jsonify({"status": "fail", "message": "Not Found"}), 404
    except Exception as e:
        # 에러 발생 시 콘솔에 찍고 500 에러를 JSON으로 반환
        print(f"🔥 서버 내부 에러: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500
    
# [문제 4] Flask 서버를 실행하는 구문을 완성하세요(포트 5000번).
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)