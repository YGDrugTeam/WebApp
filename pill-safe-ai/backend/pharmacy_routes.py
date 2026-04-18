from fastapi import Request, APIRouter, Query, HTTPException
from typing import Optional, List
from pydantic import BaseModel

try:
    from pharmacy_service import PharmacyService, PharmacyItem
except ImportError:
    from backend.pharmacy_service import PharmacyService, PharmacyItem

router = APIRouter(prefix="/api/pharmacies", tags=["pharmacies"])

pharmacy_service = PharmacyService()


class PharmacyResponse(BaseModel):
    """Response model for pharmacy items"""
    name: str
    address: str
    phone: str
    distance_km: Optional[float]
    lat: Optional[float]
    lon: Optional[float]
    kakao_map_url: str
    kakao_roadview_url: str
    raw: dict


class PharmacySearchResponse(BaseModel):
    """Response model for search results"""
    results: List[PharmacyResponse]
    total: int
    query: str


def _to_pharmacy_response(item: PharmacyItem) -> PharmacyResponse:
    return PharmacyResponse(
        name=item.name,
        address=item.address,
        phone=item.phone,
        distance_km=item.distance_km,
        lat=item.lat,
        lon=item.lon,
        kakao_map_url=item.get_kakao_map_url(),
        kakao_roadview_url=item.get_kakao_roadview_url(),
        raw=item.raw,
    )


# --- POST /api/pharmacies/search (프론트엔드 호환) ---
@router.post("/search", response_model=List[PharmacyResponse])
async def search_pharmacies_post(request: Request):
    """
    약국 검색 API (POST)
    - body: {q, limit, lat, lon, radius_km, sort}
    """
    if not pharmacy_service.is_configured():
        raise HTTPException(status_code=503, detail="약국 서비스가 설정되지 않았습니다. 관리자에게 문의하세요.")
    try:
        data = await request.json()
        results = pharmacy_service.search(
            q=data.get("q"),
            limit=int(data.get("limit", 10)),
            lat=data.get("lat"),
            lon=data.get("lon"),
            radius_km=data.get("radius_km"),
            sort=data.get("sort", "relevance"),
        )
        return [_to_pharmacy_response(item) for item in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"약국 검색(POST) 중 오류가 발생했습니다: {str(e)}")


# --- GET /api/pharmacies/search ---
@router.get("/search", response_model=PharmacySearchResponse)
async def search_pharmacies(
    q: str = Query(..., description="검색어 (약국명 또는 지역명)"),
    limit: int = Query(10, ge=1, le=100, description="최대 결과 수"),
    lat: Optional[float] = Query(None, description="사용자 위도"),
    lon: Optional[float] = Query(None, description="사용자 경도"),
    radius_km: Optional[float] = Query(None, ge=0.1, le=50, description="검색 반경 (km)"),
    sort: str = Query("relevance", regex="^(relevance|distance)$", description="정렬 방식"),
):
    """약국 검색 API (GET)"""
    if not pharmacy_service.is_configured():
        raise HTTPException(status_code=503, detail="약국 서비스가 설정되지 않았습니다. 관리자에게 문의하세요.")
    try:
        results = pharmacy_service.search(q=q, limit=limit, lat=lat, lon=lon, radius_km=radius_km, sort=sort)
        return PharmacySearchResponse(
            results=[_to_pharmacy_response(item) for item in results],
            total=len(results),
            query=q,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"약국 검색 중 오류가 발생했습니다: {str(e)}")


@router.get("/health")
async def health_check():
    """서비스 상태 확인"""
    return {
        "status": "healthy" if pharmacy_service.is_configured() else "not_configured",
        "service": "pharmacy_search",
    }
