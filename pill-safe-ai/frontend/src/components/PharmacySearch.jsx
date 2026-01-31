import React, { useState, useEffect, useMemo } from 'react';
import PharmacyList from './PharmacyList';
import PharmacyMap from './PharmacyMap';
import './PharmacySearch.css';

const PharmacySearch = () => {
  const [query, setQuery] = useState('');
  const [rawResults, setRawResults] = useState([]);
  const [isSearched, setIsSearched] = useState(false);
  const [geo, setGeo] = useState({ lat: null, lon: null, enabled: false });
  const [sort, setSort] = useState('relevance');
  const [radiusKm, setRadiusKm] = useState(3);
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);

  useEffect(() => {
    fetch('/pharmacies.json')
      .then(res => res.json())
      .then(data => setRawResults(Array.isArray(data) ? data : []))
      .catch(() => setRawResults([]));
  }, []);

  // [로직] TM 좌표를 위경도로 근사 변환 (서울 지역 최적화 계수 적용)
  const transformCoords = (x, y) => {
    if (!x || !y) return { lat: null, lon: null };
    // 서울 지역 TM -> WGS84 근사 변환 로직
    const lat = 37.5665 + (y - 450000) / 111000;
    const lon = 126.9780 + (x - 200000) / 89000;
    return { lat, lon };
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*(Math.PI/180)) * Math.cos(lat2*(Math.PI/180)) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const processedData = useMemo(() => {
    if (!isSearched) return [];
    
    let filtered = rawResults.filter(item => 
      item.사업장명?.includes(query) || item.도로명주소?.includes(query)
    );

    return filtered.map(item => {
      const { lat, lon } = transformCoords(item["좌표정보(X)"], item["좌표정보(Y)"]);
      const dist = geo.enabled ? calculateDistance(geo.lat, geo.lon, lat, lon) : null;
      
      // 전화번호 포맷팅 (서울 02 추가)
      const rawTel = String(item.전화번호 || '');
      const formattedTel = rawTel.length > 4 ? `02-${rawTel.slice(0, -4)}-${rawTel.slice(-4)}` : rawTel;

      return { ...item, lat, lon, computedDist: dist, displayTel: formattedTel };
    }).filter(item => {
      if (geo.enabled && sort === 'distance') return item.computedDist <= radiusKm;
      return true;
    }).sort((a, b) => {
      if (geo.enabled && sort === 'distance') return a.computedDist - b.computedDist;
      return 0;
    });
  }, [isSearched, query, rawResults, geo, sort, radiusKm]);

  return (
    <div className="v10-root">
      <header className="v10-header">
        <div className="v10-container">
          <div className="v10-title-area">
            <span className="v10-sub">Safe & Quick</span>
            <h1>동네 약국 <span>실시간 검색</span></h1>
          </div>
        </div>
      </header>

      <div className="v10-container">
        <section className="v10-search-box">
          <form className="v10-input-line" onSubmit={(e) => { e.preventDefault(); setIsSearched(true); }}>
            <div className="v10-search-field">
              <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="약국 이름 또는 주소를 입력하세요" />
            </div>
            <button type="submit" className="v10-main-btn">검색</button>
          </form>

          <div className="v10-filter-bar">
            <div className="v10-sort-tabs">
              <button className={sort==='relevance'?'active':''} onClick={()=>setSort('relevance')}>정확도</button>
              <button className={sort==='distance'?'active':''} onClick={()=>setSort('distance')}>거리순</button>
              <div className={`v10-indicator ${sort}`} />
            </div>

            <button className={`v10-geo-toggle ${geo.enabled?'active':''}`} onClick={() => {
              if(geo.enabled) setGeo({lat:null, lon:null, enabled:false});
              else navigator.geolocation.getCurrentPosition(p => setGeo({lat:p.coords.latitude, lon:p.coords.longitude, enabled:true}));
            }}>
              <span className="v10-pulse" />
              {geo.enabled ? '내 위치 기반' : '내 위치 활성화'}
            </button>

            {geo.enabled && (
              <div className="v10-range">
                <span>반경 <b>{radiusKm}km</b></span>
                <input type="range" min="1" max="10" value={radiusKm} onChange={(e)=>setRadiusKm(Number(e.target.value))} />
              </div>
            )}
          </div>
        </section>

        <main className="v10-list-view">
          {isSearched && (
            <>
              <div className="v10-summary">검색 결과 <span>{processedData.length}</span>건</div>
              <PharmacyList results={processedData} onMapClick={setSelectedPharmacy} />
            </>
          )}
        </main>
      </div>

      {selectedPharmacy && (
        <PharmacyMap 
          lat={selectedPharmacy.lat} 
          lon={selectedPharmacy.lon} 
          name={selectedPharmacy.사업장명} 
          onClose={() => setSelectedPharmacy(null)} 
        />
      )}
    </div>
  );
};

export default PharmacySearch;