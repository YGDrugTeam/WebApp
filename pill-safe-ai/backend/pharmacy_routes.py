from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

try:
    from pharmacy_service import PharmacyService
except ImportError:  # pragma: no cover
    from .pharmacy_service import PharmacyService

router = APIRouter(prefix="/api/pharmacies", tags=["pharmacies"])
pharmacy_service = PharmacyService()

class PharmacyResponse(BaseModel):
    name: str
    address: str
    phone: str
    distance_km: Optional[float]
    lat: Optional[float]
    lon: Optional[float]
    kakao_map_url: str
    kakao_roadview_url: str
    raw: dict



def _to_response(item):
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


@router.post("/search", response_model=List[PharmacyResponse])
async def search_pharmacies_post(request: Request):
    if not pharmacy_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="약국 서비스가 설정되지 않았습니다. 관리자에게 문의하세요.",
        )

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
        return [_to_response(item) for item in results]
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"약국 검색(POST) 중 오류가 발생했습니다: {exc}",
        )


@router.get("/search", response_model=PharmacySearchResponse)
async def search_pharmacies(
    q: str = Query(..., description="검색어 (약국명 또는 지역명)"),
    limit: int = Query(10, ge=1, le=100, description="최대 결과 수"),
    lat: Optional[float] = Query(None, description="사용자 위도"),
    lon: Optional[float] = Query(None, description="사용자 경도"),
    radius_km: Optional[float] = Query(None, ge=0.1, le=50, description="검색 반경 (km)"),
    sort: str = Query("relevance", pattern="^(relevance|distance)$", description="정렬 방식"),
):
    if not pharmacy_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="약국 서비스가 설정되지 않았습니다. 관리자에게 문의하세요.",
        )

    try:
        results = pharmacy_service.search(
            q=q,
            limit=limit,
            lat=lat,
            lon=lon,
            radius_km=radius_km,
            sort=sort,
        )
        payload = [_to_response(item) for item in results]
        return PharmacySearchResponse(results=payload, total=len(payload), query=q)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"약국 검색 중 오류가 발생했습니다: {exc}",
        )


@router.get("/health")
async def health_check():
    return {
        "status": "healthy" if pharmacy_service.is_configured() else "not_configured",
        "service": "pharmacy_search",
    }

# Import your pharmacy service
from backend.pharmacy_service import PharmacyService, PharmacyItem

router = APIRouter(prefix="/api/pharmacies", tags=["pharmacies"])

# Initialize pharmacy service
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


# --- POST /api/pharmacies/search (프론트엔드 호환) ---
@router.post("/search", response_model=List[PharmacyResponse])
async def search_pharmacies_post(
    request: Request,
):
    """
    약국 검색 API (POST)
    - 프론트엔드 POST 요청 호환용
    - body: {q, limit, lat, lon, radius_km, sort}
    """
    if not pharmacy_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="약국 서비스가 설정되지 않았습니다. 관리자에게 문의하세요."
        )
    try:
        data = await request.json()
        q = data.get("q")
        limit = int(data.get("limit", 10))
        lat = data.get("lat")
        lon = data.get("lon")
        radius_km = data.get("radius_km")
        sort = data.get("sort", "relevance")
        results = pharmacy_service.search(
            q=q,
            limit=limit,
            lat=lat,
            lon=lon,
            radius_km=radius_km,
            sort=sort,
        )
        pharmacy_responses = [
            PharmacyResponse(
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
            for item in results
        ]
        return pharmacy_responses
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"약국 검색(POST) 중 오류가 발생했습니다: {str(e)}"
        )

from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List
from pydantic import BaseModel

# Import your pharmacy service
from backend.pharmacy_service import PharmacyService, PharmacyItem

router = APIRouter(prefix="/api/pharmacies", tags=["pharmacies"])

# Initialize pharmacy service
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


@router.get("/search", response_model=PharmacySearchResponse)
async def search_pharmacies(
    q: str = Query(..., description="검색어 (약국명 또는 지역명)"),
    limit: int = Query(10, ge=1, le=100, description="최대 결과 수"),
    lat: Optional[float] = Query(None, description="사용자 위도"),
    lon: Optional[float] = Query(None, description="사용자 경도"),
    radius_km: Optional[float] = Query(None, ge=0.1, le=50, description="검색 반경 (km)"),
    sort: str = Query("relevance", regex="^(relevance|distance)$", description="정렬 방식"),
):
    """
    약국 검색 API
    
    - **q**: 검색어 (필수) - 약국 이름 또는 지역명 (예: "공덕", "서울약국")
    - **limit**: 반환할 최대 결과 수 (기본값: 10)
    - **lat**: 사용자 위도 (옵션)
    - **lon**: 사용자 경도 (옵션)
    - **radius_km**: 검색 반경 (km, 옵션)
    - **sort**: 정렬 방식 - "relevance" 또는 "distance" (기본값: relevance)
    """
    
    if not pharmacy_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="약국 서비스가 설정되지 않았습니다. 관리자에게 문의하세요."
        )
    
    try:
        # Search pharmacies
        results = pharmacy_service.search(
            q=q,
            limit=limit,
            lat=lat,
            lon=lon,
            radius_km=radius_km,
            sort=sort,
        )
        
        # Convert to response format
        pharmacy_responses = [
            PharmacyResponse(
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
            for item in results
        ]
        
        return PharmacySearchResponse(
            results=pharmacy_responses,
            total=len(pharmacy_responses),
            query=q,
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"약국 검색 중 오류가 발생했습니다: {str(e)}"
        )


@router.get("/health")
async def health_check():
    """서비스 상태 확인"""
    return {
        "status": "healthy" if pharmacy_service.is_configured() else "not_configured",
        "service": "pharmacy_search",
    }
