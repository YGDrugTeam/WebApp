import React from 'react';
import './PharmacyList.css';

const PharmacyList = ({ results, onMapClick }) => {
  if (!results || results.length === 0) return (
    <div className="v11-no-results">찾으시는 약국 정보가 없습니다.</div>
  );

  // [수정] 요청하신 2가지 케이스에 맞춘 정밀 포맷팅
  const formatTel = (raw) => {
    const str = String(raw || '');
    if (!str || str === '0') return null;
    
    // CASE 2: 70으로 시작하는 인터넷 전화 (070 부여)
    if (str.startsWith('70')) {
      return `070-${str.slice(2, 6)}-${str.slice(6)}`;
    }

    // CASE 1: 2로 시작하는 일반 번호 (앞의 2를 02로 간주하여 중복 방지)
    // 데이터가 '234119305'인 경우 -> 02-3411-9305
    if (str.startsWith('2')) {
      const body = str.slice(1); // '2'를 제외한 나머지
      if (body.length === 8) {
        return `02-${body.slice(0, 4)}-${body.slice(4)}`;
      } else if (body.length === 7) {
        return `02-${body.slice(0, 3)}-${body.slice(3)}`;
      }
    }
    
    // 기타 예외 케이스: 단순히 앞에 0만 붙여서 출력
    return `0${str}`;
  };

  return (
    <div className="v11-grid">
      {results.map((item, idx) => {
        const rhythmClass = idx % 2 === 0 ? 'v11-card-even' : 'v11-card-odd';
        const displayPhone = formatTel(item.전화번호);
        
        return (
          <div key={idx} className={`v11-card ${rhythmClass}`}>
            <div className="v11-accent-bar" />
            
            <div className="v11-card-inner">
              <div className="v11-card-header">
                <div className="v11-tag-group">
                  <span className="v11-tag status-pill">영업중</span>
                  <span className="v11-tag type-pill">전문약국</span>
                </div>
                {item.computedDist && (
                  <div className="v11-distance">
                    <span className="num">{item.computedDist.toFixed(1)}</span>
                    <span className="unit">km</span>
                  </div>
                )}
              </div>

              <div className="v11-card-body">
                <h3 className="v11-name">{item.사업장명}</h3>
                <p className="v11-addr">{item.도로명주소}</p>
                
                <div className="v11-divider" />
                
                <div className="v11-action-row">
                  {displayPhone ? (
                    <a href={`tel:${displayPhone.replace(/-/g, '')}`} className="v11-phone-link">
                      <span className="icon">📞</span>
                      <span className="text">{displayPhone}</span>
                    </a>
                  ) : (
                    <span className="v11-no-phone">전화번호 정보 없음</span>
                  )}
                  <div className="v11-badge-consult">복약지도 우수</div>
                </div>
              </div>

              <div className="v11-card-footer">
                <button className="v11-map-trigger" onClick={() => onMapClick(item)}>
                  📍 지도에서 위치 확인하기
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PharmacyList;