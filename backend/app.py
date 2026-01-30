import os
import io

from flask import Flask, jsonify, make_response, request
from flask_cors import CORS

from info_service import PillInfoService
from pharmacy_service import PharmacyService, PharmacyServiceError

# Optional ML deps (allow server to start even if not installed)
try:  # pragma: no cover
    import torch
    import torchvision.transforms as transforms
    from PIL import Image
except Exception:  # pragma: no cover
    torch = None
    transforms = None
    Image = None

try:  # pragma: no cover
    from azure.ai.vision.imageanalysis import ImageAnalysisClient
    from azure.core.credentials import AzureKeyCredential
except Exception:  # pragma: no cover
    ImageAnalysisClient = None
    AzureKeyCredential = None

# Optional OCR fallback deps
try:  # pragma: no cover
    import numpy as np
except Exception:  # pragma: no cover
    np = None

try:  # pragma: no cover
    import easyocr
except Exception:  # pragma: no cover
    easyocr = None

from pharmacy_service import PharmacyService, PharmacyServiceError
try:
    from dur_service import DurService, DurServiceError
except Exception:  # pragma: no cover
    from .dur_service import DurService, DurServiceError

app = Flask(__name__)
pharmacy_service = PharmacyService()

# 서비스 초기화
info_service = PillInfoService()
# 캐시 강제 초기화 엔드포인트 (관리용)
pharmacy_service = PharmacyService()

# Azure 설정 (환경 변수에서 가져옴)
endpoint = os.getenv("AZURE_VISION_ENDPOINT")
key = os.getenv("AZURE_VISION_KEY")

# 클라이언트 초기화 (optional)
vision_client = None
if ImageAnalysisClient and AzureKeyCredential and endpoint and key:
    try:
        vision_client = ImageAnalysisClient(endpoint=endpoint, credential=AzureKeyCredential(key))
    except Exception as e:
        print(f"Azure Vision Client 초기화 실패: {e}")

# --- 전체 약품 정보 요약 API ---
@app.route('/api/pills', methods=['GET'])
def get_all_pills():
    """모든 약품의 주요 정보를 리스트로 반환 (프론트엔드용)"""
    try:
        pills = []
        for pill_id, info in info_service.pill_data_json.items():
            if not isinstance(info, dict):
                continue
            pills.append({
                "id": pill_id,
                "name": info.get("name", ""),
                "manufacturer": info.get("manufacturer", ""),
                "effect": info.get("effect", ""),
                "usage": info.get("usage", ""),
                "caution": info.get("caution", ""),
                "storage": info.get("storage", "")
            })
        return jsonify({"status": "success", "data": pills})
    except Exception as e:
        print(f"🔥 /api/pills 에러: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500
import os
import io

from flask import Flask, jsonify, make_response, request
from flask_cors import CORS

from info_service import PillInfoService
from pharmacy_service import PharmacyService, PharmacyServiceError

# Optional ML deps (allow server to start even if not installed)
try:  # pragma: no cover
    import torch
    import torchvision.transforms as transforms
    from PIL import Image
except Exception:  # pragma: no cover
    torch = None
    transforms = None
    Image = None

try:  # pragma: no cover
    from azure.ai.vision.imageanalysis import ImageAnalysisClient
    from azure.core.credentials import AzureKeyCredential
except Exception:  # pragma: no cover
    ImageAnalysisClient = None
    AzureKeyCredential = None

# Optional OCR fallback deps
try:  # pragma: no cover
    import numpy as np
except Exception:  # pragma: no cover
    np = None

try:  # pragma: no cover
    import easyocr
except Exception:  # pragma: no cover
    easyocr = None

try:
    from dur_service import DurService, DurServiceError
except Exception:  # pragma: no cover
    from .dur_service import DurService, DurServiceError

app = Flask(__name__)
CORS(app)

# 서비스 초기화
info_service = PillInfoService()
pharmacy_service = PharmacyService()

# Azure 설정 (환경 변수에서 가져옴)
endpoint = os.getenv("AZURE_VISION_ENDPOINT")
key = os.getenv("AZURE_VISION_KEY")

# 클라이언트 초기화 (optional)
vision_client = None
if ImageAnalysisClient and AzureKeyCredential and endpoint and key:
    try:
        vision_client = ImageAnalysisClient(endpoint=endpoint, credential=AzureKeyCredential(key))
    except Exception as e:
        print(f"❌ Azure Vision client init failed: {e}")

# --- AI 모델 로드 설정 ---
DEVICE = torch.device("cuda" if torch and torch.cuda.is_available() else "cpu") if torch else None
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'epoch50+epoch20_Augmentation1.pth')

# 실제 모델 아키텍처에 맞게 클래스를 정의해야 합니다 (예시: MobileNetV2 기반 등)
# 여기서는 모델 파일만 로드하는 기본 구조를 잡습니다.
def load_pill_model():
    try:
        if not torch:
            return None
        # 주의: 모델 아키텍처 코드가 있어야 합니다. 
        # 만약 모델 정의 코드가 따로 있다면 그 클래스를 불러와야 합니다.
        model = torch.load(MODEL_PATH, map_location=DEVICE)
        if isinstance(model, torch.nn.Module):
            model.eval()
            return model
        return None
    except Exception as e:
        print(f"❌ 모델 로드 실패: {e}")
        return None

pill_model = load_pill_model()

_easyocr_reader = None


def _ensure_pillow_antialias_compat():
    """Restore PIL.Image.ANTIALIAS for Pillow>=10.

    EasyOCR 1.7.0 references Image.ANTIALIAS, which was removed in newer Pillow.
    On very new Python versions, downgrading Pillow may not be feasible, so we
    patch the attribute at runtime.
    """
    if not Image:
        return
    try:
        if hasattr(Image, "ANTIALIAS"):
            return
        # Match the historical behavior (an int-like resampling constant).
        if hasattr(Image, "Resampling") and hasattr(Image.Resampling, "LANCZOS"):
            Image.ANTIALIAS = int(Image.Resampling.LANCZOS)
        elif hasattr(Image, "LANCZOS"):
            Image.ANTIALIAS = int(Image.LANCZOS)
        else:
            Image.ANTIALIAS = 1
    except Exception as e:
        print(f"⚠️ Pillow compat patch failed: {e}")


def _get_easyocr_reader():
    global _easyocr_reader
    if _easyocr_reader is not None:
        return _easyocr_reader
    if not easyocr:
        return None
    try:
        _ensure_pillow_antialias_compat()
        # Korean + English best-effort
        _easyocr_reader = easyocr.Reader(['ko', 'en'], gpu=False)
        return _easyocr_reader
    except Exception as e:
        print(f"❌ EasyOCR init failed: {e}")
        return None

# 이미지 전처리 설정 (optional)
transform = None
if transforms:
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])

def _new_request_id() -> str:
    import uuid
    return uuid.uuid4().hex[:12]

# --- API 엔드포인트 ---

@app.route('/search', methods=['GET'])
def search_pill():
    """텍스트 기반 의약품 검색"""
    try:
        pill_name = request.args.get('name')
        result = info_service.search_and_announce(pill_name)

        if result:
            return jsonify({"status": "success", "data": result})
        return jsonify({"status": "fail", "message": "해당하는 약 정보를 찾을 수 없습니다."}), 404
    except Exception as e:
        print(f"🔥 서버 내부 에러: {e}")
        return jsonify({"status": "error", "message": "데이터를 처리하는 중 오류가 발생했습니다."}), 500

@app.route('/predict', methods=['POST'])
def predict_pill():
    """AI 이미지 기반 의약품 식별"""
    if 'file' not in request.files:
        return jsonify({"status": "fail", "message": "파일이 없습니다."}), 400

    if not (torch and Image and transform and pill_model):
        return jsonify({
            "status": "fail",
            "message": "이미지 식별 기능이 준비되지 않았어요. (torch/torchvision/pillow 또는 모델 로드 필요)",
        }), 503
    
    file = request.files['file']
    try:
        image = Image.open(file).convert('RGB')
        input_tensor = transform(image).unsqueeze(0).to(DEVICE)
        
        with torch.no_grad():
            outputs = pill_model(input_tensor)
            _, predicted = torch.max(outputs, 1)
            
        # 예측된 클래스 ID를 기반으로 JSON에서 정보 추출
        # (모델의 Output Index와 JSON의 매칭 로직이 필요합니다)
        predicted_class_id = str(predicted.item()) 
        
        # 임시로 첫 번째 검색 결과 반환 (실제로는 클래스 맵핑 테이블 필요)
        result = info_service.search_and_announce("아로나민") # 예시
        
        return jsonify({"status": "success", "data": result})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/ml/analyze/ocr', methods=['POST'])
def analyze_ocr():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file"}), 400
        
        file = request.files['file']
        image_data = file.read()
        print(f"📸 이미지 수신 완료: {len(image_data)} bytes")

        extracted_text = ""

        # 1) Prefer Azure Vision (if configured)
        if vision_client:
            result = vision_client.analyze(
                image_data=image_data,
                visual_features=["read"],
            )

            if result.read is not None:
                for line in result.read.blocks[0].lines:  # 첫 번째 블록의 라인들 추출
                    extracted_text += line.text + " "

            # 만약 한 줄도 없다면 전체 블록 순회
            if not extracted_text.strip() and result.read is not None:
                for block in result.read.blocks:
                    for line in block.lines:
                        extracted_text += line.text + " "
        else:
            # 2) Fallback: EasyOCR (if installed)
            reader = _get_easyocr_reader()
            if reader and Image and np is not None:
                try:
                    _ensure_pillow_antialias_compat()
                    img = Image.open(io.BytesIO(image_data)).convert('RGB')
                    arr = np.array(img)
                    lines = reader.readtext(arr, detail=0)
                    extracted_text = " ".join([str(x).strip() for x in (lines or []) if str(x).strip()])
                except Exception as e:
                    print(f"❌ EasyOCR analyze failed: {e}")
                    return jsonify({
                        "status": "fail",
                        "message": "OCR 분석에 실패했어요. (EasyOCR 오류)",
                    }), 500
            else:
                return jsonify({
                    "status": "fail",
                    "message": "OCR 기능이 준비되지 않았어요. (Azure Vision 설정 또는 EasyOCR 설치 필요)",
                }), 503

        print(f"📝 추출된 텍스트: {extracted_text.strip()}")

        # 검색 서비스 연동 (추출된 텍스트가 있을 때만)
        pill_info = None
        if extracted_text.strip():
            # 추출된 텍스트 중 약 이름이 포함되어 있는지 검색
            pill_info = info_service.search_and_announce(extracted_text.strip())

        return jsonify({
            "status": "success",
            "detected_text": extracted_text.strip(),
            "data": pill_info  # 'pill_info' 대신 'data'로 키 이름을 통일해 보세요.
        })
    except Exception as e:
        print(f"🔥 OCR 에러 발생: {str(e)}")
        return jsonify({"error": f"OCR 분석 중 오류가 발생했습니다: {str(e)}"}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "model_loaded": pill_model is not None}), 200


@app.route('/ml/dur/status', methods=['GET'])
def dur_status():
    """병용 금기(DUR) 기능 상태"""
    req_id = _new_request_id()
    try:
        svc = DurService()
        resp = make_response(
            jsonify({"status": "success", "available": bool(svc.is_configured()), "configured": bool(svc.is_configured())}),
            200,
        )
        resp.headers["X-Request-Id"] = req_id
        return resp
    except Exception as e:
        print(f"DUR status error: {e}")
        resp = make_response(jsonify({"status": "error", "message": "병용 금기 상태 확인에 실패했어요."}), 500)
        resp.headers["X-Request-Id"] = req_id
        return resp


@app.route('/ml/dur/check', methods=['POST'])
def dur_check():
    """복용 약 조합에 대한 병용 금기(DUR) 체크"""
    req_id = _new_request_id()
    try:
        payload = request.get_json(silent=True) or {}
        raw_drugs = payload.get('drugs')

        drugs = []
        if isinstance(raw_drugs, list):
            for d in raw_drugs:
                if isinstance(d, dict):
                    n = str(d.get('name') or '').strip()
                else:
                    n = str(d or '').strip()
                if n:
                    drugs.append(n)

        svc = DurService()
        hits = svc.check_pairs(drugs)
        resp = make_response(
            jsonify({"status": "success", "available": True, "data": [h.to_dict() for h in hits]}),
            200,
        )
        resp.headers["X-Request-Id"] = req_id
        return resp
    except DurServiceError as e:
        resp = make_response(
            jsonify({"status": "fail", "code": e.code, "message": e.public_message}),
            503,
        )
        resp.headers["X-Request-Id"] = req_id
        return resp
    except Exception as e:
        print(f"DUR check error: {e}")
        resp = make_response(
            jsonify({"status": "error", "message": "병용 금기 확인 중 오류가 발생했어요."}),
            500,
        )
        resp.headers["X-Request-Id"] = req_id
        return resp

@app.route('/pharmacies', methods=['GET'])
def get_pharmacies():
    req_id = _new_request_id()
    try:
        q = str(request.args.get('q', '') or '').strip()
        limit = request.args.get('limit', '10')
        sort = str(request.args.get('sort', 'relevance') or 'relevance').strip()

        lat_raw = request.args.get('lat')
        lon_raw = request.args.get('lon')
        radius_raw = request.args.get('radius_km')

        lat = float(lat_raw) if lat_raw not in (None, '') else None
        lon = float(lon_raw) if lon_raw not in (None, '') else None
        radius_km = float(radius_raw) if radius_raw not in (None, '') else None

        items = pharmacy_service.search(
            q=q,
            limit=int(limit or 10),
            lat=lat,
            lon=lon,
            radius_km=radius_km,
            sort=sort,
        )

        resp = make_response(
            jsonify({"status": "success", "data": [i.to_dict() for i in items]}),
            200,
        )
        resp.headers["X-Request-Id"] = req_id
        return resp
    except PharmacyServiceError as e:
        resp = make_response(
            jsonify({"status": "fail", "code": e.code, "message": e.public_message}),
            503,
        )
        resp.headers["X-Request-Id"] = req_id
        return resp
    except ValueError:
        resp = make_response(
            jsonify({"status": "fail", "code": "PHARMACY_BAD_REQUEST", "message": "요청 파라미터 형식이 올바르지 않아요."}),
            400,
        )
        resp.headers["X-Request-Id"] = req_id
        return resp
    except Exception as e:
        print(f"Pharmacy API Error: {e}")
        resp = make_response(
            jsonify({"status": "error", "message": "약국 정보를 불러오지 못했어요."}),
            500,
        )
        resp.headers["X-Request-Id"] = req_id
        return resp


@app.route('/pharmacies/status', methods=['GET'])
def pharmacies_status():
    """약국 찾기 기능 상태(프론트 초기 체크용)"""
    req_id = _new_request_id()
    available = bool(pharmacy_service.is_configured())

    missing = []
    try:
        try:
            from settings import PHARMACY_LOCAL_CSV, PHARMACY_SERVICE_PATH, ODCLOUD_SERVICE_KEY, ODCLOUD_AUTHORIZATION
        except Exception:  # pragma: no cover
            from .settings import PHARMACY_LOCAL_CSV, PHARMACY_SERVICE_PATH, ODCLOUD_SERVICE_KEY, ODCLOUD_AUTHORIZATION

        local_csv = str(PHARMACY_LOCAL_CSV or '').strip()

        # If a local CSV is configured, ODCloud config is optional.
        if not local_csv:
            if not str(PHARMACY_SERVICE_PATH or '').strip():
                missing.append('PHARMACY_LOCAL_CSV(or PHARMACY_SERVICE_PATH)')
            if not (str(ODCLOUD_SERVICE_KEY or '').strip() or str(ODCLOUD_AUTHORIZATION or '').strip()):
                missing.append('ODCLOUD_SERVICE_KEY(or ODCLOUD_AUTHORIZATION)')
    except Exception:
        # Best-effort only; status should still return.
        missing = []

    hint = ''
    if not available:
        hint = (
            '약국 찾기 설정이 필요해요. 기본 제공 CSV(backend/data/pharmacies_seoul_utf8.csv)가 없으면 '
            'backend/.env에 PHARMACY_LOCAL_CSV(로컬 CSV 경로) 또는 PHARMACY_SERVICE_PATH(ODCloud 데이터셋 경로)와 '
            'ODCLOUD_SERVICE_KEY(또는 ODCLOUD_AUTHORIZATION)를 설정해주세요.'
        )

    resp = make_response(
        jsonify(
            {
                "status": "success",
                "available": available,
                "configured": available,
                "missing": missing,
                "hint": hint,
            }
        ),
        200,
    )
    resp.headers["X-Request-Id"] = req_id
    return resp

if __name__ == "__main__":
    debug = str(os.getenv("FLASK_DEBUG", "")).strip() in {"1", "true", "True"}
    app.run(host="0.0.0.0", port=5000, debug=debug, use_reloader=debug)