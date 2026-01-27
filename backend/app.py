from flask import Flask, jsonify, make_response, request
from flask_cors import CORS
from info_service import PillInfoService

# 기존의 복잡한 try-except 임포트를 지우고 아래 한 줄로 통일하세요
from pharmacy_service import PharmacyService, PharmacyServiceError

app = Flask(__name__)
CORS(app)


def _new_request_id() -> str:
    import uuid

    return uuid.uuid4().hex[:12]


info_service = PillInfoService()
pharmacy_service = PharmacyService()


@app.route('/search', methods=['GET'])
def search_pill():
    try:
        pill_name = request.args.get('name')
        result = info_service.search_and_announce(pill_name)

        if result:
            return jsonify({"status": "success", "data": result})
        return jsonify({"status": "fail", "message": "Not Found"}), 404
    except Exception as e:
        print(f"🔥 서버 내부 에러: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    request_id = _new_request_id()
    resp = make_response(jsonify({"status": "ok"}), 200)
    resp.headers["X-Request-Id"] = request_id
    return resp


@app.route('/api/pharmacies', methods=['GET'])
def search_pharmacies():
    """약국 찾기 (실데이터; ODCloud 기반)

    예: GET /pharmacies?q=강남 약국&limit=10
    """
    request_id = _new_request_id()
    try:
        q = request.args.get('q', default='', type=str)
        limit = request.args.get('limit', default=10, type=int)
        lat = request.args.get('lat', default=None, type=float)
        lon = request.args.get('lon', default=None, type=float)
        radius_km = request.args.get('radius_km', default=None, type=float)
        sort = request.args.get('sort', default='relevance', type=str)
        if not (q or '').strip():
            resp = make_response(jsonify({"status": "fail", "message": "q is required"}), 400)
            resp.headers["X-Request-Id"] = request_id
            return resp

        items = pharmacy_service.search(q=q, limit=limit, lat=lat, lon=lon, radius_km=radius_km, sort=sort)
        resp = make_response(
            jsonify({"status": "success", "count": len(items), "data": [x.to_dict() for x in items]}),
            200,
        )
        resp.headers["X-Request-Id"] = request_id
        return resp
    except PharmacyServiceError as e:
        # Do not leak internal env var names to end users.
        print(
            f"⚠️ pharmacy search error: request_id={request_id} code={getattr(e, 'code', 'PHARMACY_ERROR')} detail={e}"
        )
        status_code = 503 if getattr(e, 'code', '') == 'PHARMACY_NOT_CONFIGURED' else 502
        resp = make_response(
            jsonify(
                {
                    "status": "fail",
                    "code": getattr(e, 'code', 'PHARMACY_ERROR'),
                    "message": getattr(e, 'public_message', '약국 정보를 불러오지 못했어요.'),
                }
            ),
            status_code,
        )
        resp.headers["X-Request-Id"] = request_id
        return resp
    except Exception as e:
        print(f"🔥 서버 내부 에러: request_id={request_id} {e}")
        resp = make_response(jsonify({"status": "error", "message": "internal error"}), 500)
        resp.headers["X-Request-Id"] = request_id
        return resp


@app.route('/pharmacies/status', methods=['GET'])
def pharmacies_status():
    """약국 찾기 기능 사용 가능 여부 (실데이터 설정 상태 확인)

    - 사용자에게 env 변수명을 노출하지 않음
    - 프론트에서 UI 비활성화/배지 표시에 사용
    """

    request_id = _new_request_id()
    try:
        available = pharmacy_service.is_configured()
        if available:
            resp = make_response(jsonify({"status": "success", "available": True}), 200)
            resp.headers["X-Request-Id"] = request_id
            return resp

        resp = make_response(
            jsonify(
                {
                    "status": "success",
                    "available": False,
                    "code": "PHARMACY_NOT_CONFIGURED",
                    "message": "약국 찾기 서비스가 아직 준비되지 않았어요.",
                }
            ),
            200,
        )
        resp.headers["X-Request-Id"] = request_id
        return resp
    except Exception as e:
        print(f"🔥 pharmacies_status error: request_id={request_id} {e}")
        resp = make_response(jsonify({"status": "error", "message": "internal error"}), 500)
        resp.headers["X-Request-Id"] = request_id
        return resp


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)