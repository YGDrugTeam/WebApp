import React from 'react';

// 심플한 Leaflet 지도 컴포넌트 (약국 위치 표시)
// 설치 필요: npm install leaflet react-leaflet
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const PharmacyMap = ({ lat, lon, markers = [], height = 320 }) => {
  if (!lat || !lon) return <div>위치 정보가 없습니다.</div>;
  return (
    <div style={{ width: '100%', height }}>
      <MapContainer center={[lat, lon]} zoom={15} style={{ width: '100%', height: '100%', borderRadius: 16 }} scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lon]}>
          <Popup>여기가 선택한 위치입니다.</Popup>
        </Marker>
        {markers.map((m, i) => (
          <Marker key={i} position={[m.lat, m.lon]}>
            <Popup>{m.label || '약국'}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default PharmacyMap;
