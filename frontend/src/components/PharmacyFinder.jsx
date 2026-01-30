// src/components/PharmacyFinder.jsx (새 파일)
import React, { useState, useEffect } from 'react';
import './PharmacyFinder.css';

const PharmacyFinder = () => {
  const [pharmacies, setPharmacies] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [map, setMap] = useState(null);
  const [searchMethod, setSearchMethod] = useState('kakao'); // 'kakao', 'public', 'hybrid'


  useEffect(() => {
    // 사용자 위치 가져오기
    if (!navigator.geolocation) {
      console.error('Geolocation API를 지원하지 않습니다.');
      alert('이 브라우저는 위치 기능을 지원하지 않습니다.');
      setUserLocation({ lat: 37.5665, lng: 126.9780 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('[위치] 성공:', position);
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      (error) => {
        console.error('[위치] 실패:', error);
        alert('위치 정보를 가져올 수 없습니다. 기본 위치(서울)로 검색합니다.');
        setUserLocation({ lat: 37.5665, lng: 126.9780 });
      }
    );

    // 카카오맵 스크립트 로드
    loadKakaoMapScript();
  }, []);

  // PharmacyFinder.jsx 내 개선 로직
  const initMap = () => {
    if (!userLocation) {
      console.warn('[지도] userLocation이 아직 없습니다.');
      return;
    }
    if (!window.kakao || !window.kakao.maps) {
      console.error('[지도] window.kakao/maps가 없습니다.');
      return;
    }
    const container = document.getElementById('map');
    if (!container) {
      console.error('[지도] #map 컨테이너가 없습니다.');
      return;
    }
    const options = {
      center: new window.kakao.maps.LatLng(userLocation.lat, userLocation.lng),
      level: 3
    };
    const newMap = new window.kakao.maps.Map(container, options);
    // 내 위치 마커 표시
    const marker = new window.kakao.maps.Marker({
      position: new window.kakao.maps.LatLng(userLocation.lat, userLocation.lng),
      map: newMap
    });
    setMap(newMap);
    console.log('[지도] 지도 생성 완료:', newMap);
  };

const loadKakaoMapScript = () => {
  if (window.kakao && window.kakao.maps) {
    console.log('[카카오맵] 이미 window.kakao.maps가 있음');
    return;
  }
  const key = (import.meta?.env?.VITE_KAKAO_MAP_KEY || '').replace(/['"`]/g, '').trim();
  if (!key) {
    alert('카카오맵 API 키(VITE_KAKAO_MAP_KEY)가 설정되어 있지 않습니다. .env 파일을 확인하세요.');
    return;
  }
  const script = document.createElement('script');
  script.async = true;
  script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`;
  script.onerror = () => {
    console.error('[카카오맵] 스크립트 로드 실패:', script.src);
    alert('카카오맵 스크립트 로드에 실패했습니다. API 키와 네트워크를 확인하세요.');
  };
  document.head.appendChild(script);
  script.onload = () => {
    if (!window.kakao || !window.kakao.maps) {
      console.error('[카카오맵] window.kakao/maps가 없음 (onload)');
      alert('카카오맵 로드에 실패했습니다.');
      return;
    }
    window.kakao.maps.load(() => {
      console.log('[카카오맵] window.kakao.maps.load 완료');
      initMap();
    });
  };
};

  // 1. 카카오맵 API로 검색
  const searchWithKakao = () => {
    if (!userLocation || !window.kakao) return Promise.reject('카카오맵 로드 안됨');

    return new Promise((resolve, reject) => {
      const { kakao } = window;
      const ps = new kakao.maps.services.Places();

      ps.keywordSearch('약국', (data, status) => {
        if (status === kakao.maps.services.Status.OK) {
          const results = data.map(place => ({
            source: 'kakao',
            name: place.place_name,
            address: place.address_name,
            roadAddress: place.road_address_name,
            phone: place.phone,
            lat: parseFloat(place.y),
            lng: parseFloat(place.x),
            distance: place.distance,
            url: place.place_url
          }));
          resolve(results);
        } else {
          reject('카카오 검색 실패');
        }
      }, {
        location: new kakao.maps.LatLng(userLocation.lat, userLocation.lng),
        radius: 2000
      });
    });
  };

  // 2. 공공데이터 API로 검색
  const searchWithPublicAPI = async () => {
    const API_KEY = 'YOUR_PUBLIC_DATA_API_KEY';
    const url = `https://apis.data.go.kr/B551182/pharmacyInfoService/getParmacyBasisList`;
    
    const params = new URLSearchParams({
      serviceKey: decodeURIComponent(API_KEY),
      xPos: userLocation.lng,
      yPos: userLocation.lat,
      radius: 2000,
      pageNo: 1,
      numOfRows: 20,
      _type: 'json'
    });

    try {
      const response = await fetch(`${url}?${params}`);
      const data = await response.json();
      
      if (data.response?.body?.items?.item) {
        const items = Array.isArray(data.response.body.items.item) 
          ? data.response.body.items.item 
          : [data.response.body.items.item];
        
        return items.map(item => ({
          source: 'public',
          name: item.yadmNm,
          address: item.addr,
          phone: item.telno,
          lat: parseFloat(item.YPos),
          lng: parseFloat(item.XPos)
        }));
      }
      return [];
    } catch (error) {
      console.error('공공데이터 검색 실패:', error);
      return [];
    }
  };

  // Flask 백엔드에서 약국 리스트 가져오기
  const searchWithFlask = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lat: userLocation?.lat,
        lon: userLocation?.lng,
        radius_km: 2,
        limit: 20,
        q: '', // 검색어를 넣을 수 있음
      });
      const response = await fetch(`http://localhost:5000/pharmacies?${params}`);
      const data = await response.json();
      if (data.status === 'success') {
        setPharmacies(
          data.data.map(item => ({
            source: 'flask',
            name: item.name,
            address: item.address,
            phone: item.phone,
            lat: item.lat,
            lng: item.lon,
            distance: item.distance_km ? item.distance_km * 1000 : null,
          }))
        );
        displayMap(
          data.data.map(item => ({
            name: item.name,
            address: item.address,
            phone: item.phone,
            lat: item.lat,
            lng: item.lon,
          }))
        );
      } else {
        setPharmacies([]);
      }
    } catch (e) {
      setPharmacies([]);
      alert('Flask 백엔드에서 약국 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 3. 하이브리드 검색 (카카오 + 공공데이터 병합)
  const searchHybrid = async () => {
    setLoading(true);
    
    try {
      const [kakaoResults, publicResults] = await Promise.allSettled([
        searchWithKakao(),
        searchWithPublicAPI()
      ]);

      let combined = [];

      if (kakaoResults.status === 'fulfilled') {
        combined = [...kakaoResults.value];
      }

      if (publicResults.status === 'fulfilled') {
        // 중복 제거 (이름과 거리 기준)
        publicResults.value.forEach(pub => {
          const isDuplicate = combined.some(k => 
            k.name.includes(pub.name) || pub.name.includes(k.name)
          );
          if (!isDuplicate) {
            combined.push(pub);
          }
        });
      }

      // 거리순 정렬
      combined.sort((a, b) => {
        const distA = calculateDistance(userLocation.lat, userLocation.lng, a.lat, a.lng);
        const distB = calculateDistance(userLocation.lat, userLocation.lng, b.lat, b.lng);
        return distA - distB;
      });

      setPharmacies(combined);
      displayMap(combined);
    } catch (error) {
      console.error('하이브리드 검색 실패:', error);
      alert('약국 검색에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 거리 계산 (Haversine formula)
  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371e3; // 지구 반지름 (미터)
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // 미터 단위
  };

  // 지도에 표시
  const displayMap = (pharmacyList) => {
    if (!window.kakao || !userLocation) return;

    const { kakao } = window;
    const container = document.getElementById('pharmacy-map');
    const options = {
      center: new kakao.maps.LatLng(userLocation.lat, userLocation.lng),
      level: 4
    };

    const newMap = new kakao.maps.Map(container, options);
    setMap(newMap);

    // 내 위치 마커
    const myMarker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(userLocation.lat, userLocation.lng),
      map: newMap,
      image: new kakao.maps.MarkerImage(
        'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
        new kakao.maps.Size(24, 35)
      )
    });

    // 약국 마커들
    pharmacyList.forEach((pharmacy, index) => {
      const markerPosition = new kakao.maps.LatLng(pharmacy.lat, pharmacy.lng);
      const marker = new kakao.maps.Marker({
        position: markerPosition,
        map: newMap
      });

      const infowindow = new kakao.maps.InfoWindow({
        content: `
          <div style="padding:10px;min-width:200px;">
            <strong>${pharmacy.name}</strong><br/>
            <span style="font-size:12px;color:#666;">
              ${pharmacy.source === 'kakao' ? '🗺️ 카카오' : '🏥 공공데이터'}
            </span><br/>
            ${pharmacy.phone || '전화번호 없음'}
          </div>
        `
      });

      kakao.maps.event.addListener(marker, 'click', () => {
        infowindow.open(newMap, marker);
      });
    });
  };

  return (
    <div className="pharmacy-finder-container">
      <div className="pharmacy-header">
        <h2>🏥 주변 약국 찾기</h2>
        <p>현재 위치 기준 2km 이내 약국을 검색합니다</p>
      </div>


      <div className="search-controls">
        <button 
          onClick={searchHybrid} 
          disabled={!userLocation || loading}
          className="search-btn"
        >
          {loading ? '🔍 검색 중...' : '🎯 하이브리드 검색'}
        </button>
        <button
          onClick={searchWithFlask}
          disabled={!userLocation || loading}
          className="search-btn"
          style={{ marginLeft: '8px', background: '#2d6cdf', color: '#fff' }}
        >
          {loading ? '🔄 불러오는 중...' : '🌐 Flask 약국 검색'}
        </button>
        <div className="search-info">
          {userLocation ? (
            <span>✅ 위치: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}</span>
          ) : (
            <span>📍 위치 정보 가져오는 중...</span>
          )}
        </div>
      </div>

      <div id="pharmacy-map" className="pharmacy-map"></div>

      <div className="pharmacy-list">
        <h3>검색 결과 ({pharmacies.length}개)</h3>
        {pharmacies.map((pharmacy, index) => {
          const distance = calculateDistance(
            userLocation?.lat || 0, 
            userLocation?.lng || 0, 
            pharmacy.lat, 
            pharmacy.lng
          );
          
          return (
            <div key={index} className="pharmacy-card">
              <div className="pharmacy-badge">
                {pharmacy.source === 'kakao' ? '🗺️ 카카오맵' : '🏥 공공데이터'}
              </div>
              <h4>{pharmacy.name}</h4>
              <p className="address">📍 {pharmacy.address}</p>
              {pharmacy.roadAddress && (
                <p className="road-address">🛣️ {pharmacy.roadAddress}</p>
              )}
              <p className="phone">📞 {pharmacy.phone || '정보 없음'}</p>
              <p className="distance">🚶 약 {Math.round(distance)}m</p>
              
              <div className="pharmacy-actions">
                <button 
                  onClick={() => window.open(
                    `https://map.kakao.com/link/to/${pharmacy.name},${pharmacy.lat},${pharmacy.lng}`
                  )}
                  className="btn-navigate"
                >
                  🧭 길찾기
                </button>
                
                {pharmacy.phone && (
                  <button 
                    onClick={() => window.location.href = `tel:${pharmacy.phone}`}
                    className="btn-call"
                  >
                    📞 전화하기
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PharmacyFinder;