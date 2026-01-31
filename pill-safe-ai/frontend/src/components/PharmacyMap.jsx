// components/PharmacyMap.jsx
import React, { useMemo } from 'react';

const PharmacyMap = ({ lat, lon, name, onClose }) => {
  // OSM 임베드 URL 생성 로직
  const mapUrl = useMemo(() => {
    if (lat == null || lon == null) return '';
    const delta = 0.003; // 확대 레벨 조정 (값이 작을수록 확대)
    const left = lon - delta;
    const right = lon + delta;
    const top = lat + delta;
    const bottom = lat - delta;
    
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
      `${left},${bottom},${right},${top}`
    )}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
  }, [lat, lon]);

  if (!mapUrl) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{name || '약국 위치'}</h3>
            <p className="text-xs text-slate-500">지도를 움직여 주변을 확인할 수 있습니다.</p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition"
          >
            닫기
          </button>
        </div>

        {/* 지도 영역 */}
        <div className="flex-1 bg-slate-100 relative min-h-[400px]">
          <iframe
            title="Pharmacy Location"
            width="100%"
            height="100%"
            frameBorder="0"
            scrolling="no"
            marginHeight="0"
            marginWidth="0"
            src={mapUrl}
            className="absolute inset-0 w-full h-full"
          />
        </div>
      </div>
    </div>
  );
};

export default PharmacyMap;