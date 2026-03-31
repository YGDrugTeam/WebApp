import React, { useEffect, useMemo, useRef, useState } from 'react';
import PharmacyMap from '../components/PharmacyMap';
import PharmacyFinder from '../components/PharmacyFinder';
import PharmacySearch from '../components/PharmacySearch';

const MainPage = () => {
  // InfoCard 폰트 크기 상태
  const [infoCardFontSize, setInfoCardFontSize] = useState(1.0); // rem 단위 배율
  // --- 상태 관리 (State) ---
  const [searchTerm, setSearchTerm] = useState(''); // 텍스트 검색어
  const [results, setResults] = useState([]);      // 검색 결과 리스트
  const [loading, setLoading] = useState(false);   // 로딩 상태
  const [selectedImage, setSelectedImage] = useState(null); // 이미지 미리보기
  const [selectedFile, setSelectedFile] = useState(null); // 업로드 파일(백엔드 전송용)
  const [isFilterOpen, setIsFilterOpen] = useState(false); // 상세 필터 열림 여부

  const uploadInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const webcamVideoRef = useRef(null);
  const webcamCanvasRef = useRef(null);
  const webcamStreamRef = useRef(null);

  const [isWebcamOpen, setIsWebcamOpen] = useState(false);
  const [webcamMode, setWebcamMode] = useState('environment'); // environment | user
  const [webcamError, setWebcamError] = useState('');
  const [webcamStarting, setWebcamStarting] = useState(false);

  const [pharmacyQuery, setPharmacyQuery] = useState('');
  const [pharmacyLoading, setPharmacyLoading] = useState(false);
  const [pharmacyResults, setPharmacyResults] = useState([]);
  const [pharmacyError, setPharmacyError] = useState('');
  // input 이벤트 핸들러로 쓸 때는 반드시 e.target.value 또는 value만 넘길 것!

  const handlePharmacySearch = async (qOverride) => {
    let q = qOverride ?? pharmacyQuery;
    // 이벤트 객체가 들어오면 value 추출
    if (q && typeof q === 'object' && q.target && typeof q.target.value === 'string') {
      q = q.target.value;
    }
    q = String(q ?? '').trim();
    setPharmacyError('');
    setErrorMessage('');
    setInfoMessage('');
    setPharmacyLoading(true);
    try {
      if (pharmacyAvailable === false) {
        setPharmacyResults([]);
        setPharmacyError('약국 검색 기능이 현재 비활성화되어 있습니다. 관리자에게 문의하세요.');
        return;
      }
      // 실제 약국 검색 API 호출
      const payload = {
        q,
        sort: pharmacySort,
        limit: 10,
      };
      if (geo.enabled) {
        payload.lat = geo.lat;
        payload.lon = geo.lon;
        payload.radius_km = radiusKm;
      }
      const resp = await fetch(apiUrl('/api/pharmacy/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const rawText = await resp.text().catch(() => '');
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }
      if (!resp.ok || !Array.isArray(data)) {
        setPharmacyResults([]);
        setPharmacyError(data?.message || '검색 결과를 찾지 못했어요.');
        return;
      }
      setPharmacyResults(data);
      setInfoMessage(data.length ? '약국 검색 결과를 불러왔어요.' : '검색 결과가 없습니다.');
    } catch (e) {
      setPharmacyResults([]);
      setPharmacyError(
        API_BASE
          ? '서버에 연결할 수 없어요. 백엔드 주소와 Render 배포 상태를 확인해주세요.'
          : '서버에 연결할 수 없어요. Vite 개발 서버와 FastAPI가 실행 중인지 확인해주세요.',
      );
    } finally {
      setPharmacyLoading(false);
    }
  };

  // 렌더링은 파일 하단의 정상적인 return을 사용합니다.
  const [geo, setGeo] = useState({ enabled: false, lat: null, lon: null, accuracy: null });
  const [radiusKm, setRadiusKm] = useState(2);
  const [geoLoading, setGeoLoading] = useState(false);
  const [pharmacySort, setPharmacySort] = useState('relevance'); // relevance | distance
  const [pharmacyAvailable, setPharmacyAvailable] = useState(null); // null | boolean
  const [pharmacyMapOpen, setPharmacyMapOpen] = useState(false);
  const [pharmacyMapTarget, setPharmacyMapTarget] = useState(null);
  const [pharmacyMapState, setPharmacyMapState] = useState({ loading: false, error: '', lat: null, lon: null });

  const isDev = Boolean(import.meta?.env?.DEV);
  const [devDiag, setDevDiag] = useState({
    origin: window.location.origin,
    flask: { ok: null, status: null, requestId: null },
    pharmacy: { ok: null, available: null, code: null, status: null, requestId: null },
  });

  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [ocrLines, setOcrLines] = useState([]);
  const [ocrLoading, setOcrLoading] = useState(false);

  const [savedMeds, setSavedMeds] = useState([]); // 복용 중인 약 목록
  const [durLoading, setDurLoading] = useState(false);
  const [durResults, setDurResults] = useState([]);
  // caution 기반 경고 안내
  const [pillCautions, setPillCautions] = useState({});
  const [cautionWarnings, setCautionWarnings] = useState([]);
  // 전체 약물 데이터
  const [pills, setPills] = useState([]);
  // 태그 클릭 시 보여줄 정보 카드 리스트
  const [infoCards, setInfoCards] = useState([]);

  // 모든 약의 caution 필드 불러오기 (최초 1회)
  // useEffect(() => {
  //   fetch('/api/pills')
  //     .then((r) => r.json())
  //     .then((data) => {
  //       if (Array.isArray(data)) {
  //         setPills(data);
  //         // {약이름: caution, ...} 형태로 변환
  //         const map = {};
  //         data.forEach((pill) => {
  //           const name = String(pill?.ITEM_NAME || pill?.제품명 || pill?.품목명 || pill?.name || '').trim();
  //           const caution = String(pill?.caution || pill?.CAUTION || pill?.주의사항 || '').trim();
  //           if (name && caution) map[name] = caution;
  //         });
  //         setPillCautions(map);
  //       }
  //     })
  //     .catch(() => {});
  // }, []);

  // 임상적 주의 조합별 상세 이유 매핑
  const cautionReasons = {
    '이부프로펜:아스피린': '같은 계열(NSAIDs) 약물 중복 복용 시 위장 장애(위궤양, 출혈) 및 신장 손상 위험이 급격히 높아집니다.',
    '이부프로펜:나프록센': '같은 계열(NSAIDs) 약물 중복 복용 시 위장 장애(위궤양, 출혈) 및 신장 손상 위험이 급격히 높아집니다.',
    '이부프로펜:세레콕시브': '같은 계열(NSAIDs) 약물 중복 복용 시 위장 장애(위궤양, 출혈) 및 신장 손상 위험이 급격히 높아집니다.',
    '이부프로펜:와파린': '이부프로펜은 혈소판 응집을 억제하여, 혈액 응고 저지제와 함께 복용 시 출혈 위험이 커집니다.',
    '이부프로펜:헤파린': '이부프로펜은 혈소판 응집을 억제하여, 혈액 응고 저지제와 함께 복용 시 출혈 위험이 커집니다.',
    '이부프로펜:클로피도그렐': '이부프로펜은 혈소판 응집을 억제하여, 혈액 응고 저지제와 함께 복용 시 출혈 위험이 커집니다.',
    '이부프로펜:저용량 아스피린': '이부프로펜은 혈소판 응집을 억제하여, 혈액 응고 저지제와 함께 복용 시 출혈 위험이 커집니다.',
    '이부프로펜:에날라프릴': '이부프로펜은 신장 혈류를 줄여 혈압약(ACE 저해제) 효과를 떨어뜨리고, 신부전 위험이 있습니다.',
    '이부프로펜:로사르탄': '이부프로펜은 신장 혈류를 줄여 혈압약(ARB) 효과를 떨어뜨리고, 신부전 위험이 있습니다.',
    '이부프로펜:푸로세미드': '이부프로펜은 신장 혈류를 줄여 이뇨제 효과를 떨어뜨리고, 신부전 위험이 있습니다.',
    '이부프로펜:프레드니솔론': '이부프로펜과 스테로이드 병용 시 위점막 손상 및 위장관 출혈 위험이 크게 높아집니다.',
    '이부프로펜:덱사메타손': '이부프로펜과 스테로이드 병용 시 위점막 손상 및 위장관 출혈 위험이 크게 높아집니다.',
    '이부프로펜:플루옥세틴': 'SSRI(항우울제)와 소염진통제 병용 시 소화기계 출혈 빈도가 증가합니다.',
    '이부프로펜:설트랄린': 'SSRI(항우울제)와 소염진통제 병용 시 소화기계 출혈 빈도가 증가합니다.',
    // 역방향도 포함
    '아스피린:이부프로펜': '같은 계열(NSAIDs) 약물 중복 복용 시 위장 장애(위궤양, 출혈) 및 신장 손상 위험이 급격히 높아집니다.',
    '나프록센:이부프로펜': '같은 계열(NSAIDs) 약물 중복 복용 시 위장 장애(위궤양, 출혈) 및 신장 손상 위험이 급격히 높아집니다.',
    '세레콕시브:이부프로펜': '같은 계열(NSAIDs) 약물 중복 복용 시 위장 장애(위궤양, 출혈) 및 신장 손상 위험이 급격히 높아집니다.',
    '와파린:이부프로펜': '이부프로펜은 혈소판 응집을 억제하여, 혈액 응고 저지제와 함께 복용 시 출혈 위험이 커집니다.',
    '헤파린:이부프로펜': '이부프로펜은 혈소판 응집을 억제하여, 혈액 응고 저지제와 함께 복용 시 출혈 위험이 커집니다.',
    '클로피도그렐:이부프로펜': '이부프로펜은 혈소판 응집을 억제하여, 혈액 응고 저지제와 함께 복용 시 출혈 위험이 커집니다.',
    '저용량 아스피린:이부프로펜': '이부프로펜은 혈소판 응집을 억제하여, 혈액 응고 저지제와 함께 복용 시 출혈 위험이 커집니다.',
    '에날라프릴:이부프로펜': '이부프로펜은 신장 혈류를 줄여 혈압약(ACE 저해제) 효과를 떨어뜨리고, 신부전 위험이 있습니다.',
    '로사르탄:이부프로펜': '이부프로펜은 신장 혈류를 줄여 혈압약(ARB) 효과를 떨어뜨리고, 신부전 위험이 있습니다.',
    '푸로세미드:이부프로펜': '이부프로펜은 신장 혈류를 줄여 이뇨제 효과를 떨어뜨리고, 신부전 위험이 있습니다.',
    '프레드니솔론:이부프로펜': '이부프로펜과 스테로이드 병용 시 위점막 손상 및 위장관 출혈 위험이 크게 높아집니다.',
    '덱사메타손:이부프로펜': '이부프로펜과 스테로이드 병용 시 위점막 손상 및 위장관 출혈 위험이 크게 높아집니다.',
    '플루옥세틴:이부프로펜': 'SSRI(항우울제)와 소염진통제 병용 시 소화기계 출혈 빈도가 증가합니다.',
    '설트랄린:이부프로펜': 'SSRI(항우울제)와 소염진통제 병용 시 소화기계 출혈 빈도가 증가합니다.',
  };

  useEffect(() => {
    const keywords = [
      '아스피린','나프록센','세레콕시브','와파린','헤파린','클로피도그렐','저용량 아스피린',
      '에날라프릴','로사르탄','푸로세미드','프레드니솔론','덱사메타손','플루옥세틴','설트랄린','이부프로펜'
    ];
    const found = [];
    // 키워드 쌍이 모두 복용 목록에 있으면 무조건 경고 생성
    for (let i = 0; i < keywords.length; i++) {
      for (let j = i + 1; j < keywords.length; j++) {
        const medA = keywords[i];
        const medB = keywords[j];
        if (savedMeds.includes(medA) && savedMeds.includes(medB)) {
          const key = `${medA}:${medB}`;
          // 실제 caution 텍스트가 있으면 보여주고, 없으면 기본 안내
          const cautionA = pillCautions[medA] || '';
          const cautionB = pillCautions[medB] || '';
          found.push({
            med: medA,
            kw: medB,
            caution: cautionA || cautionB || '이 약물 조합은 임상적으로 주의가 필요합니다. 반드시 전문가와 상담하세요.',
            reason: cautionReasons[key] || cautionReasons[`${medB}:${medA}`] || '',
          });
        }
      }
    }
    setCautionWarnings(found);
  }, [savedMeds, pillCautions]);
  const [durError, setDurError] = useState('');
  const [durStatus, setDurStatus] = useState({ checkedAt: null, available: null, source: '', message: '' });
  const [durQuickAdd, setDurQuickAdd] = useState('');
  const [durSheetOpen, setDurSheetOpen] = useState(false);
  const [durSelectedHit, setDurSelectedHit] = useState(null);
  const [durSheetMounted, setDurSheetMounted] = useState(false);
  const [durSheetVisible, setDurSheetVisible] = useState(false);

  const [filters, setFilters] = useState({
    pregnancy: false,
    drowsy: false,
    alcohol: false,
    age: '', // 연령대: '' | 'child' | 'teen' | 'adult' | 'senior'
  });

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter(Boolean).length,
    [filters],
  );

  const FLASK_BASE = String(import.meta?.env?.VITE_FLASK_BASE || '').trim().replace(/\/$/, '');
  const FASTAPI_BASE = String(import.meta?.env?.VITE_FASTAPI_BASE || '').trim().replace(/\/$/, '');
  const DEFAULT_RENDER_API_BASE = 'https://careflow-webapp.onrender.com';
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const API_BASE = FASTAPI_BASE || FLASK_BASE || (isLocalHost ? '' : DEFAULT_RENDER_API_BASE);
  const apiUrl = (path) => (API_BASE ? `${API_BASE}${path}` : path);

  // 복용 약 localStorage sync
  useEffect(() => {
    try {
      const raw = localStorage.getItem('mediclens.savedMeds') || '[]';
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const cleaned = arr
          .map((x) => String(x || '').trim())
          .filter(Boolean)
          .slice(0, 20);
        setSavedMeds(cleaned);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('mediclens.savedMeds', JSON.stringify(savedMeds));
    } catch {
      // ignore
    }
  }, [savedMeds]);

  const addSavedMed = (name) => {
    const n = String(name || '').trim();
    if (!n) return;
    setSavedMeds((prev) => {
      const next = Array.isArray(prev) ? [...prev] : [];
      const exists = next.some((x) => String(x).toLowerCase() === n.toLowerCase());
      if (!exists) next.unshift(n);
      return next.slice(0, 20);
    });
    setInfoMessage('복용 목록에 추가했어요.');
  };

  const removeSavedMed = (name) => {
    const n = String(name || '').trim();
    if (!n) return;
    setSavedMeds((prev) => (Array.isArray(prev) ? prev.filter((x) => String(x).toLowerCase() !== n.toLowerCase()) : []));
  };

  const clearSavedMeds = () => {
    setSavedMeds([]);
    setDurResults([]);
    setDurError('');
  };

  const runDurCheck = async () => {
    setDurError('');
    setDurResults([]);
    if (!savedMeds || savedMeds.length < 2) {
      setDurError('병용 금기 확인은 2개 이상의 약을 추가해야 해요.');
      return;
    }

    setDurLoading(true);
    try {
      const payload = { drugs: savedMeds.map((n) => ({ name: n })) };
      const candidates = [{ label: 'backend', url: apiUrl('/api/dur/check') }];

      let lastErr = '';
      let items = [];

      for (const c of candidates) {
        try {
          const resp = await fetch(c.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          const rawText = await resp.text().catch(() => '');
          let data = {};
          try {
            data = rawText ? JSON.parse(rawText) : {};
          } catch {
            data = {};
          }

          if (!resp.ok) {
            const detail = data?.detail;
            const msgFromDetail =
              detail && typeof detail === 'object'
                ? String(detail?.message || detail?.code || '').trim()
                : String(detail || '').trim();
            const msg =
              msgFromDetail ||
              String(data?.message || data?.error || '').trim() ||
              (rawText ? String(rawText).trim().slice(0, 200) : '');

            lastErr = msg
              ? `병용 금기 확인에 실패했어요. (HTTP ${resp.status}) ${msg}`
              : `병용 금기 확인에 실패했어요. (HTTP ${resp.status})`;

            // If the proxy/upstream is down, try next candidate.
            if (resp.status === 404 || resp.status === 502 || resp.status === 503 || resp.status === 504) {
              continue;
            }
            continue;
          }

          items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          lastErr = '';
          break;
        } catch (e) {
          console.warn(`dur check request failed (${c.label})`, e);
          lastErr = API_BASE
            ? '서버에 연결할 수 없어요. 백엔드 주소와 Render 배포 상태를 확인해주세요.'
            : '서버에 연결할 수 없어요. Vite 개발 서버와 FastAPI가 실행 중인지 확인해주세요.';
        }
      }

      if (lastErr) {
        setDurError(lastErr);
        return;
      }

      setDurResults(items);
      setInfoMessage(items.length ? '병용 금기 결과를 확인했어요.' : '현재 추가된 조합에서 병용 금기 근거를 찾지 못했어요.');
      setTimeout(() => {
        document.getElementById('interaction')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (e) {
      console.error(e);
      setDurError(
        API_BASE
          ? '서버에 연결할 수 없어요. 백엔드 주소와 Render 배포 상태를 확인해주세요.'
          : '서버에 연결할 수 없어요. Vite 개발 서버와 FastAPI가 실행 중인지 확인해주세요.',
      );
    } finally {
      setDurLoading(false);
    }
  };

  const fetchDurStatus = async () => {
    const candidates = [{ label: 'backend', url: apiUrl('/api/dur/status') }];

    for (const c of candidates) {
      try {
        const resp = await fetch(c.url, { method: 'GET' });
        const rawText = await resp.text().catch(() => '');
        let data = {};
        try {
          data = rawText ? JSON.parse(rawText) : {};
        } catch {
          data = {};
        }

        if (!resp.ok) {
          const msg =
            String(data?.message || data?.error || '').trim() ||
            (rawText ? String(rawText).trim().slice(0, 160) : '');
          setDurStatus({ checkedAt: new Date(), available: false, source: c.label, message: msg });
          if (resp.status === 404 || resp.status === 502 || resp.status === 503 || resp.status === 504) continue;
          return;
        }

        const available = Boolean(data?.available ?? data?.configured ?? false);
        setDurStatus({ checkedAt: new Date(), available, source: c.label, message: '' });
        return;
      } catch {
        // try next candidate
      }
    }

    setDurStatus({ checkedAt: new Date(), available: null, source: '', message: '서버에 연결할 수 없어요.' });
  };

  useEffect(() => {
    fetchDurStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!durSheetOpen) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setDurSheetOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [durSheetOpen]);

  useEffect(() => {
    // Mount -> animate in
    if (durSheetOpen) {
      setDurSheetMounted(true);
      // Next tick so transitions apply
      const t = setTimeout(() => setDurSheetVisible(true), 10);
      return () => clearTimeout(t);
    }

    // Animate out -> unmount
    setDurSheetVisible(false);
    const t = setTimeout(() => setDurSheetMounted(false), 220);
    return () => clearTimeout(t);
  }, [durSheetOpen]);

  const openDurSheet = (hit) => {
    setDurSelectedHit(hit || null);
    setDurSheetOpen(true);
  };

  const closeDurSheet = () => {
    setDurSheetOpen(false);
  };

  const _toFloat = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const _extractLatLonFromItem = (p) => {
    const directLat = _toFloat(p?.lat ?? p?.latitude);
    const directLon = _toFloat(p?.lon ?? p?.lng ?? p?.longitude);
    if (directLat != null && directLon != null) return { lat: directLat, lon: directLon };

    const raw = p?.raw && typeof p.raw === 'object' ? p.raw : null;
    if (!raw) return { lat: null, lon: null };

    const lat = _toFloat(
      raw['위도'] ?? raw['LAT'] ?? raw['lat'] ?? raw['Latitude'] ?? raw['latitude'] ?? raw['Y'] ?? raw['y'],
    );
    const lon = _toFloat(
      raw['경도'] ?? raw['LON'] ?? raw['lon'] ?? raw['Longitude'] ?? raw['longitude'] ?? raw['X'] ?? raw['x'],
    );
    return { lat: lat ?? null, lon: lon ?? null };
  };

  const _geocode = async (query) => {
    const q = String(query || '').trim();
    if (!q) return null;

    // 1) Kakao geocoder (if SDK is present + services loaded)
    try {
      const kakao = typeof window !== 'undefined' ? window.kakao : null;
      if (kakao?.maps?.services?.Geocoder) {
        const geocoder = new kakao.maps.services.Geocoder();
        const result = await new Promise((resolve) => {
          geocoder.addressSearch(q, (res, status) => resolve({ res, status }));
        });
        if (result?.status === kakao.maps.services.Status.OK && Array.isArray(result?.res) && result.res[0]) {
          const lat = _toFloat(result.res[0].y);
          const lon = _toFloat(result.res[0].x);
          if (lat != null && lon != null) return { lat, lon };
        }
      }
    } catch {
      // ignore and fall back
    }

    // 2) OpenStreetMap Nominatim (no key). Best-effort; may be rate-limited.
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      const j = await r.json().catch(() => []);
      const first = Array.isArray(j) ? j[0] : null;
      const lat = _toFloat(first?.lat);
      const lon = _toFloat(first?.lon);
      if (lat != null && lon != null) return { lat, lon };
    } catch {
      // ignore
    }

    return null;
  };

  const _openPharmacyMap = async (p) => {
    setPharmacyMapTarget(p);
    setPharmacyMapOpen(true);
    setPharmacyMapState({ loading: true, error: '', lat: null, lon: null });

    const { lat, lon } = _extractLatLonFromItem(p);
    if (lat != null && lon != null) {
      setPharmacyMapState({ loading: false, error: '', lat, lon });
      return;
    }

    const name = String(p?.name ?? p?.place_name ?? p?.placeName ?? '').trim();
    const address = String(p?.address ?? p?.address_name ?? p?.addressName ?? '').trim();
    const query = address || name;
    const geo = await _geocode(query);
    if (geo?.lat != null && geo?.lon != null) {
      setPharmacyMapState({ loading: false, error: '', lat: geo.lat, lon: geo.lon });
      return;
    }

    setPharmacyMapState({
      loading: false,
      error: '좌표를 찾지 못했어요. 주소가 더 구체적이면 더 잘 나와요.',
      lat: null,
      lon: null,
    });
  };

  const _closePharmacyMap = () => {
    setPharmacyMapOpen(false);
    setPharmacyMapTarget(null);
    setPharmacyMapState({ loading: false, error: '', lat: null, lon: null });
  };

  const pharmacyMapEmbedUrl = useMemo(() => {
    const lat = pharmacyMapState.lat;
    const lon = pharmacyMapState.lon;
    if (lat == null || lon == null) return '';
    const delta = 0.01;
    const left = lon - delta;
    const right = lon + delta;
    const top = lat + delta;
    const bottom = lat - delta;
    // bbox=left,bottom,right,top
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
      `${left},${bottom},${right},${top}`,
    )}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
  }, [pharmacyMapState.lat, pharmacyMapState.lon]);

  // --- 함수 (Functions) ---
  // 텍스트 검색 처리
  const handleSearch = async (termOverride) => {
    const rawTerm = termOverride ?? searchTerm;
    const term = typeof rawTerm === 'string' ? rawTerm.trim() : '';
    setErrorMessage('');
    setInfoMessage('');
    setLoading(true);
    try {
      if (!term) {
        setResults([]);
        setInfoCards([]);
        setErrorMessage('검색어를 입력해주세요.');
        return;
      }

      const url = apiUrl(`/api/search?name=${encodeURIComponent(term)}`);

      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.status !== 'success') {
        setResults([]);
        setInfoCards([]);
        setErrorMessage(data?.message || '검색 결과를 찾지 못했어요.');
        return;
      }

      setResults([data.data]);
      setInfoMessage('검색 결과를 불러왔어요.');

      // infoCards에 결과 표시 (단일/복수 모두 배열로 처리)
      const pillsArr = Array.isArray(data.data) ? data.data : [data.data];
      setInfoCards(pillsArr.filter(Boolean));

      // 결과 섹션으로 자연스럽게 이동
      setTimeout(() => {
        document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (error) {
      console.error(error);
      setResults([]);
      setInfoCards([]);
      setErrorMessage(
        API_BASE
          ? '서버에 연결할 수 없어요. 백엔드 주소와 Render 배포 상태를 확인해주세요.'
          : '서버에 연결할 수 없어요. Vite 개발 서버와 FastAPI가 실행 중인지 확인해주세요.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const checkPharmacyStatus = async () => {
      try {
        const base = FLASK_BASE ? `${FLASK_BASE}/pharmacies/status` : '/api/pharmacies/status';
        const resp = await fetch(base);
        const text = await resp.text().catch(() => '');
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }

        if (cancelled) return;
        if (resp.ok && data?.status === 'success') {
          if (typeof data?.available === 'boolean') {
            setPharmacyAvailable(data.available);
            if (!data.available) {
              disableGeolocation();
              const missing = Array.isArray(data?.missing) ? data.missing.filter(Boolean).join(', ') : '';
              const hint = String(data?.hint || '').trim();
              setPharmacyError(hint || (missing ? `약국 찾기 설정이 필요해요: ${missing}` : '약국 찾기 설정이 필요해요.'));
            }
            return;
          }
        }
        // 상태 확인 실패 시에는 기능을 막지 않고(=true 가정), 검색 시 에러로 유도
        setPharmacyAvailable(true);
      } catch (e) {
        console.warn('pharmacies status check failed', e);
        if (!cancelled) setPharmacyAvailable(true);
      }
    };

    checkPharmacyStatus();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDev) return;

    let cancelled = false;

    const check = async () => {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const flaskUrl = FLASK_BASE ? `${FLASK_BASE}/health` : '/api/health';
      const pharmacyUrl = FLASK_BASE ? `${FLASK_BASE}/pharmacies/status` : '/api/pharmacies/status';

      const next = {
        checkedAt: new Date().toISOString(),
        origin,
        flask: { ok: null, status: null, requestId: null },
        pharmacy: { ok: null, available: null, code: null, status: null, requestId: null },
      };

      // Flask health
      try {
        const r = await fetch(flaskUrl);
        next.flask.status = r.status;
        next.flask.requestId = r.headers.get('x-request-id') || r.headers.get('X-Request-Id');
        const t = await r.text().catch(() => '');
        let j = {};
        try {
          j = t ? JSON.parse(t) : {};
        } catch {
          j = {};
        }
        next.flask.ok = r.ok && j?.status === 'ok';
      } catch {
        next.flask.ok = false;
      }

      // Pharmacy status
      try {
        const r = await fetch(pharmacyUrl);
        next.pharmacy.status = r.status;
        next.pharmacy.requestId = r.headers.get('x-request-id') || r.headers.get('X-Request-Id');
        const t = await r.text().catch(() => '');
        let j = {};
        try {
          j = t ? JSON.parse(t) : {};
        } catch {
          j = {};
        }
        const available = typeof j?.available === 'boolean' ? j.available : null;
        next.pharmacy.available = available;
        next.pharmacy.code = j?.code ? String(j.code) : null;
        next.pharmacy.ok = r.ok && j?.status === 'success' && available !== null;
      } catch {
        next.pharmacy.ok = false;
      }

      if (!cancelled) setDevDiag(next);
    };

    check();
    const id = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isDev, FLASK_BASE]);

  const requestGeolocation = async () => {
    setGeoLoading(true);
    setPharmacyError('');
    try {
      if (!navigator?.geolocation) {
        setInfoMessage('이 브라우저는 위치 기능을 지원하지 않아요. 대신 검색어(지역) 기준으로 반경/거리 계산을 시도해요.');
        return;
      }

      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
        );
      }).then((pos) => {
        const p = pos;
        const lat = p?.coords?.latitude;
        const lon = p?.coords?.longitude;
        const accuracy = p?.coords?.accuracy;
        if (typeof lat === 'number' && typeof lon === 'number') {
          setGeo({ enabled: true, lat, lon, accuracy: typeof accuracy === 'number' ? accuracy : null });
        } else {
          setPharmacyError('위치 정보를 가져오지 못했어요.');
        }
      });
    } catch (e) {
      console.error(e);
      setInfoMessage('위치 권한이 없어도 검색은 가능해요. 검색어(지역) 기준으로 반경/거리 계산을 시도해요.');
      setGeo({ enabled: false, lat: null, lon: null, accuracy: null });
    } finally {
      setGeoLoading(false);
    }
  };

  const disableGeolocation = () => {
    setGeo({ enabled: false, lat: null, lon: null, accuracy: null });
  };

  const resetImageState = () => {
    setSelectedImage(null);
    setSelectedFile(null);
    setOcrLines([]);
    setErrorMessage('');
    setInfoMessage('');
  };

  const stopWebcam = () => {
    try {
      const stream = webcamStreamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
    } catch {
      // ignore
    } finally {
      webcamStreamRef.current = null;
      if (webcamVideoRef.current) {
        try {
          webcamVideoRef.current.srcObject = null;
        } catch {
          // ignore
        }
      }
    }
  };

  const startWebcam = async (modeOverride) => {
    setWebcamError('');
    setWebcamStarting(true);
    try {
      stopWebcam();
      const mode = modeOverride || webcamMode;

      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('이 브라우저는 웹캠 촬영을 지원하지 않아요.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      webcamStreamRef.current = stream;
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
        await webcamVideoRef.current.play().catch(() => {});
      }
    } catch (e) {
      const message = String(e?.message || e || '웹캠을 시작할 수 없어요.');
      setWebcamError(message);
    } finally {
      setWebcamStarting(false);
    }
  };

  const openWebcam = async () => {
    setIsWebcamOpen(true);
    await startWebcam();
  };

  const closeWebcam = () => {
    setIsWebcamOpen(false);
    stopWebcam();
  };

  const captureWebcamFrame = async () => {
    const video = webcamVideoRef.current;
    const canvas = webcamCanvasRef.current;
    if (!video || !canvas) {
      setWebcamError('웹캠 화면을 가져오지 못했어요.');
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setWebcamError('캔버스를 초기화하지 못했어요.');
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      setWebcamError('이미지 캡처에 실패했어요.');
      return;
    }

    const file = new File([blob], `webcam_${Date.now()}.jpg`, { type: 'image/jpeg' });
    applySelectedFile(file);
    closeWebcam();
  };

  const toggleWebcamMode = async () => {
    const next = webcamMode === 'environment' ? 'user' : 'environment';
    setWebcamMode(next);
    await startWebcam(next);
  };

  useEffect(() => {
    return () => {
      stopWebcam();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applySelectedFile = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setOcrLines([]);
    setErrorMessage('');
    setInfoMessage('');

    const reader = new FileReader();
    reader.onloadend = () => setSelectedImage(reader.result);
    reader.readAsDataURL(file);
  };

  // 이미지 업로드/촬영 처리
  const handleImageChange = (e) => {
    const file = e?.target?.files?.[0];
    applySelectedFile(file);
    // 같은 파일을 다시 선택해도 change 이벤트가 뜨도록 value 초기화
    if (e?.target) e.target.value = '';
  };

  const handleAnalyzeOcr = async () => {
    setErrorMessage('');
    setInfoMessage('');

    if (!selectedFile) {
      setErrorMessage('먼저 이미지를 업로드해주세요.');
      return;
    }

    setOcrLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const _normalizeDetectedText = (payload) => {
        const v = payload?.detected_text;
        if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
        if (typeof v === 'string') {
          const s = v.trim();
          if (!s) return [];
          // Flask OCR은 공백으로 이어붙인 문자열로 오는 경우가 많아서 한 줄로 취급
          return s.includes('\n') ? s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [s];
        }
        return [];
      };

      const candidates = [{ label: 'backend', url: apiUrl('/api/analyze/ocr?user_id=demo') }];

      let lastErr = 'OCR 분석에 실패했어요.';

      for (const c of candidates) {
        try {
          const response = await fetch(c.url, { method: 'POST', body: formData });
          const rawText = await response.text().catch(() => '');
          let data = {};
          try {
            data = rawText ? JSON.parse(rawText) : {};
          } catch {
            data = {};
          }

          if (!response.ok) {
            const msg =
              String(data?.detail || data?.message || data?.error || '').trim() ||
              (rawText ? String(rawText).trim().slice(0, 200) : '');

            lastErr = msg
              ? `OCR 분석에 실패했어요. (HTTP ${response.status}) ${msg}`
              : `OCR 분석에 실패했어요. (HTTP ${response.status})`;

            // 프록시/포트 문제 등으로 FastAPI가 실패하면 Flask로 폴백
            if (response.status === 404 || response.status === 502 || response.status === 503 || response.status === 504) {
              continue;
            }
            // 그 외 에러도 일단 다음 후보가 있으면 시도
            continue;
          }

          // success (FastAPI: {detected_text: []}, Flask: {status:'success', detected_text:'...'})
          const lines = _normalizeDetectedText(data);
          setOcrLines(lines);
          setInfoMessage(lines.length ? '텍스트를 추출했어요.' : '추출된 텍스트가 없어요.');
          lastErr = '';
          break;
        } catch (e) {
          console.warn(`ocr request failed (${c.label})`, e);
          lastErr = API_BASE
            ? '서버에 연결할 수 없어요. 백엔드 주소와 Render 배포 상태를 확인해주세요.'
            : '서버에 연결할 수 없어요. Vite 개발 서버와 FastAPI가 실행 중인지 확인해주세요.';
          // 네트워크 실패도 다음 후보가 있으면 계속
        }
      }

      if (lastErr) {
        setErrorMessage(lastErr);
        return;
      }

      setTimeout(() => {
        document.getElementById('image')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        API_BASE
          ? '서버에 연결할 수 없어요. 백엔드 주소와 Render 배포 상태를 확인해주세요.'
          : '서버에 연결할 수 없어요. Vite 개발 서버와 FastAPI가 실행 중인지 확인해주세요.',
      );
    } finally {
      setOcrLoading(false);
    }
  };

  const primaryResult = results?.[0];

  const getResultField = (obj, candidates) => {
    if (!obj) return '';
    for (const key of candidates) {
      const value = obj?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
    }
    return '';
  };

  const resultName = getResultField(primaryResult, ['ITEM_NAME', '제품명', '품목명', 'name', 'title']);
  const resultCompany = getResultField(primaryResult, ['ENTP_NAME', '업체명', 'company']);
  const resultChart = getResultField(primaryResult, ['CHART', '외형', 'shape', 'description']);
  const resultIngredient = getResultField(primaryResult, ['성분', '주성분', 'ingredient']);
  const resultCategory = getResultField(primaryResult, ['분류', '전문일반구분', 'category']);

  return (
    <div className="min-h-screen page-bg font-sans text-slate-900 relative">
      {/* 큰 화면: 왼쪽 데코 레일(콘텐츠는 가운데/오른쪽) */}
      <div aria-hidden className="hidden lg:block left-rail-bg" />

      {(errorMessage || infoMessage) && (
        <div className="fixed top-24 left-0 right-0 z-[60] px-6 pointer-events-none">
          <div className="mx-auto max-w-3xl space-y-2">
            {errorMessage && (
              <div className="pointer-events-auto rounded-3xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 apple-shadow">
                {errorMessage}
              </div>
            )}
            {infoMessage && (
              <div className="pointer-events-auto rounded-3xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 apple-shadow">
                {infoMessage}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="relative z-10">
      {/* 1. 네비게이션 바 */}
      <header className="sticky top-0 z-50 glass border-b border-subtle">
        <div className="px-6">
          <div className="mx-auto max-w-7xl h-20 grid grid-cols-12 items-center">
            <div className="col-span-8 lg:col-span-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-cyan-500/10 flex items-center justify-center border border-cyan-100">
                <span className="text-medic-main font-black">M</span>
              </div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight">
                <span className="text-slate-900">Medic</span>
                <span className="text-medic-main">Lens</span>
              </h1>
            </div>

            <nav className="hidden lg:flex lg:col-span-6 items-center justify-center gap-8 font-semibold text-slate-600 text-sm">
              <a href="#search" className="hover:text-slate-900 transition">의약품 검색</a>
              <a href="#interaction" className="hover:text-slate-900 transition">상호작용</a>
              <a href="#pharmacy" className="hover:text-slate-900 transition">약국 찾기</a>
              <a href="#about" className="hover:text-slate-900 transition">서비스 소개</a>
            </nav>

            <div className="col-span-4 lg:col-span-3 flex justify-end">
              <button
                type="button"
                onClick={() => document.getElementById('search')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="bg-slate-900 text-white px-5 py-2.5 rounded-full font-semibold shadow-soft hover:opacity-95 transition"
              >
                무료로 시작
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 2. 메인 히어로 & 검색 섹션 */}
      <section id="search" className="pt-14 pb-16 md:pb-20 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-cyan-100 bg-white/70 glass apple-shadow">
                <span className="h-2 w-2 rounded-full bg-medic-main"></span>
                <span className="text-xs font-semibold text-slate-700">국가 공공데이터포털 연동</span>
                <span className="text-xs font-semibold text-slate-400">·</span>
                <span className="text-xs font-semibold text-slate-600">AI 요약</span>
              </div>

              <h2 className="mt-6 text-4xl md:text-5xl font-black leading-tight tracking-tight">
                약 이름이 기억 안 나도,
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-emerald-500">사진과 키워드</span>로 찾습니다.
              </h2>
              <p className="mt-5 text-slate-600 font-medium leading-relaxed">
                제품 외형·효능·주의사항을 한 화면에서 확인하고, 복용 리스크를 빠르게 판단하세요.
              </p>

              {/* 통합 검색 카드 */}
              <div className="mt-8">
                <div className="relative rounded-4xl border border-subtle surface apple-shadow p-3 md:p-4">
                  <div className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 px-3 md:px-4 py-3 rounded-3xl bg-white border border-subtle">
                        <span className="text-slate-400">🔎</span>
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                          className="w-full bg-transparent outline-none text-slate-900 placeholder:text-slate-400 font-medium"
                          placeholder="약 이름, 성분, 증상(두통/알레르기 등)…"
                        />
                      </div>

                      {/* 상태 메시지는 상단 고정 배너로 표시 */}

                      {isFilterOpen && (
                        <div className="mt-3 rounded-3xl bg-white border border-subtle p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-bold text-slate-900">상세 필터</div>
                            <button
                              type="button"
                              onClick={() => setFilters({ pregnancy: false, drowsy: false, alcohol: false, age: '' })}
                              className="text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
                            >
                              초기화
                            </button>
                          </div>
                          <div className="grid sm:grid-cols-3 gap-3 text-sm">
                            <div className="col-span-2 flex flex-col gap-2">
                              <div className="flex gap-2">
                                <label className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-50 border border-slate-100 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={filters.pregnancy}
                                    onChange={(e) => setFilters((prev) => ({ ...prev, pregnancy: e.target.checked }))}
                                  />
                                  <span className="font-semibold text-slate-700">임산부 주의</span>
                                </label>
                                <label className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-50 border border-slate-100 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={filters.drowsy}
                                    onChange={(e) => setFilters((prev) => ({ ...prev, drowsy: e.target.checked }))}
                                  />
                                  <span className="font-semibold text-slate-700">졸음 유발</span>
                                </label>
                                <label className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-50 border border-slate-100 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={filters.alcohol}
                                    onChange={(e) => setFilters((prev) => ({ ...prev, alcohol: e.target.checked }))}
                                  />
                                  <span className="font-semibold text-slate-700">음주 금지</span>
                                </label>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="block text-xs font-bold text-slate-700 mb-1 ml-1">연령대</label>
                              <select
                                className="w-full px-3 py-2 rounded-2xl border border-slate-100 bg-slate-50 text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-cyan-200"
                                value={filters.age}
                                onChange={e => setFilters(prev => ({ ...prev, age: e.target.value }))}
                              >
                                <option value="">전체</option>
                                <option value="child">소아 (0~12세)</option>
                                <option value="teen">청소년 (13~18세)</option>
                                <option value="adult">성인 (19~64세)</option>
                                <option value="senior">고령 (65세 이상)</option>
                              </select>
                            </div>
                          </div>
                          <p className="mt-3 text-xs text-slate-500">
                            현재는 UI만 제공하며, 검색 API 연동 시 실제 필터링으로 확장할 수 있어요.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setIsFilterOpen(!isFilterOpen)}
                        className="px-4 py-3 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition"
                        aria-expanded={isFilterOpen}
                        aria-label="상세 필터"
                      >
                        ⚙️
                        {activeFilterCount > 0 && (
                          <span className="ml-2 text-xs font-black text-medic-main">{activeFilterCount}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleSearch}
                        className="px-6 py-3 rounded-3xl bg-slate-900 text-white font-semibold shadow-soft hover:opacity-95 transition"
                      >
                        {loading ? '검색 중…' : '검색'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  {/* 실제 검색 가능한 약물명 + 효능/질환 키워드 예시 모두 노출 */}
                  {['이부프로펜', '액티피드정', '낙센정', '감기약', '알레르기'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        // 효능/질환 키워드면 해당 효능에 속하는 약물명 태그 자동 생성 및 정보 카드 표시
                        const effectMap = {
                          '감기약': ['액티피드정', '부루펜정200밀리그램(이부프로펜)', '트라몰정160밀리그람(아세트아미노펜)'],
                          '알레르기': ['액티피드정'],
                        };
                        let selectedNames = [];
                        if (effectMap[chip]) {
                          selectedNames = effectMap[chip];
                          setSearchTerm(selectedNames.join(', '));
                          handleSearch(selectedNames.join(', '));
                        } else {
                          selectedNames = [chip];
                          setSearchTerm(chip);
                          handleSearch(chip);
                        }
                        // pills에서 해당 약물 정보 추출
                        const cards = pills.filter((pill) => selectedNames.includes(String(pill?.ITEM_NAME || pill?.제품명 || pill?.품목명 || pill?.name || '').trim()));
                        setInfoCards(cards);
                      }}
                      className="px-3 py-1.5 rounded-full bg-white/70 glass border border-subtle text-slate-700 font-semibold hover:bg-white transition"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                {/* 태그 클릭 시 정보 카드 리스트 */}
                {infoCards.length > 0 && (
                  <div className="mt-6 flex flex-col gap-2">
                    {/* 폰트 크기 조절 버튼 */}
                    <div className="flex gap-2 mb-2">
                      <button
                        type="button"
                        className="px-3 py-1 rounded-full border border-subtle bg-white text-slate-700 font-bold text-lg hover:bg-slate-50"
                        onClick={() => setInfoCardFontSize((s) => Math.min(s + 0.1, 2.0))}
                        aria-label="글씨 크게"
                      >
                        A+
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1 rounded-full border border-subtle bg-white text-slate-700 font-bold text-lg hover:bg-slate-50"
                        onClick={() => setInfoCardFontSize((s) => Math.max(s - 0.1, 0.7))}
                        aria-label="글씨 작게"
                      >
                        A-
                      </button>
                    </div>
                    <div className="flex-1 grid gap-4">
                      {infoCards.map((pill, idx) => {
                        const name = String(pill?.ITEM_NAME || pill?.제품명 || pill?.품목명 || pill?.name || '').trim();
                        const effect = String(pill?.effect || pill?.효능 || pill?.효능효과 || '').trim();
                        // 이미지 필드 추출 (image, 이미지, 사진 등)
                        // 이미지 필드 매핑 강화 (image, 이미지, 사진, photo, 외형사진 등)
                        const imageUrl = pill?.image || pill?.이미지 || pill?.사진 || pill?.photo || pill?.외형사진 || pill?.shape_image || '';
                        return (
                          <div
                            key={name + idx}
                            className="rounded-3xl border border-subtle bg-white p-4 shadow flex gap-4 items-start"
                            style={{ fontSize: `${infoCardFontSize}rem`, transition: 'font-size 0.2s' }}
                          >
                            <div className="w-20 h-20 flex-shrink-0 flex items-center justify-center bg-slate-50 border border-slate-100 rounded-2xl overflow-hidden">
                              {imageUrl ? (
                                <img src={imageUrl} alt={name + ' 이미지'} className="object-contain w-full h-full" />
                              ) : (
                                <span className="text-4xl text-slate-300">💊</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-lg text-slate-900 mb-1">{name}</div>
                              {effect && (
                                <div
                                  className="text-sm text-slate-700 mb-1"
                                  style={{ fontSize: `${infoCardFontSize}rem`, transition: 'font-size 0.2s' }}
                                >
                                  <span className="font-semibold">효능:</span> {effect}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div>
              {/* 오른쪽 비주얼 카드 */}
              <div className="relative">
                <div className="absolute -top-10 -left-10 h-40 w-40 rounded-full bg-cyan-500/15 blur-3xl"></div>
                <div className="absolute -bottom-16 -right-10 h-44 w-44 rounded-full bg-emerald-500/15 blur-3xl"></div>

                <div className="rounded-4xl border border-subtle surface apple-shadow p-6 md:p-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-600">AI 인식 / 공공데이터 기반</div>
                      <div className="mt-1 text-xl font-black tracking-tight text-slate-900">빠르게 확인하는 복약 안전</div>
                    </div>
                    <div className="h-12 w-12 rounded-3xl bg-cyan-500/10 border border-cyan-100 flex items-center justify-center">
                      <span className="text-medic-main text-xl">🩺</span>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-3 gap-3">
                    <div className="rounded-3xl bg-white border border-subtle p-4 text-left">
                      <div className="text-xs font-semibold text-slate-500">정확도</div>
                      <div className="mt-1 text-lg font-black text-slate-900">98%</div>
                    </div>
                    <div className="rounded-3xl bg-white border border-subtle p-4 text-left">
                      <div className="text-xs font-semibold text-slate-500">보유 데이터</div>
                      <div className="mt-1 text-lg font-black text-slate-900">5만+</div>
                    </div>
                    <div className="rounded-3xl bg-white border border-subtle p-4 text-left">
                      <div className="text-xs font-semibold text-slate-500">응답 속도</div>
                      <div className="mt-1 text-lg font-black text-slate-900">1s</div>
                    </div>
                  </div>

                  <div className="mt-6 rounded-4xl border border-dashed border-slate-200 bg-white/70 p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-3xl bg-slate-900 text-white flex items-center justify-center">📷</div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-bold text-slate-900">사진으로 찾기</div>
                        <div className="text-xs text-slate-500">정면·선명하게 촬영하면 정확도가 올라가요.</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* 검색 결과 상세 섹션: 검색 바로 아래에 표시 */}
        {primaryResult && (
          <section id="results" className="px-6 -mt-6 md:-mt-10 pb-14 md:pb-16 animate-in fade-in slide-in-from-bottom-5 duration-700">
            {/* ...existing code... */}
          </section>
        )}
      </section>

      {/* 2.5 상호작용(병용 금기) */}
      <section id="interaction" className="py-14 md:py-16 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-4xl p-8 md:p-12 border border-subtle surface apple-shadow">
            <div className="mb-7 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
              <div>
                <div className="text-xs font-black text-slate-400 uppercase tracking-tighter">복용 안전</div>
                <div className="mt-1 text-2xl md:text-3xl font-black text-slate-900 tracking-tight">상호작용 / 병용 금기</div>
                <p className="mt-2 text-sm md:text-base text-slate-600 font-medium leading-relaxed">
                  복용 중인 약을 저장하고, 함께 복용하면 안 되는 조합(병용 금기)을 빠르게 확인하세요.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="px-3 py-1 rounded-full border border-subtle bg-white text-slate-700 font-bold text-lg hover:bg-slate-50"
                    onClick={() => setInfoCardFontSize((s) => Math.min(Number((s + 0.1).toFixed(2)), 2.0))}
                    aria-label="글씨 크게"
                    title="글씨 크게"
                  >
                    글씨 크게
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1 rounded-full border border-subtle bg-white text-slate-700 font-bold text-lg hover:bg-slate-50"
                    onClick={() => setInfoCardFontSize((s) => Math.max(Number((s - 0.1).toFixed(2)), 0.7))}
                    aria-label="글씨 작게"
                    title="글씨 작게"
                  >
                    글씨 작게
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => document.getElementById('search')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="hidden sm:inline-flex px-4 py-2.5 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  검색으로
                </button>
              </div>
            </div>

            <div className="rounded-4xl border border-subtle bg-white p-5 md:p-6">
              <div className="flex flex-col lg:flex-row lg:items-end gap-4">
                <div className="flex-1">
                  <div className="text-sm font-black text-slate-900">내 복용 목록</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {durStatus.checkedAt ? `상태 확인: ${new Date(durStatus.checkedAt).toLocaleString()}` : '상태 확인: -'}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="flex items-center gap-2 rounded-3xl border border-subtle bg-slate-50 px-3 py-2">
                    <input
                      value={durQuickAdd}
                      onChange={(e) => setDurQuickAdd(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSavedMed(durQuickAdd);
                          setDurQuickAdd('');
                        }
                      }}
                      placeholder="약 이름 추가"
                      className="bg-transparent outline-none text-sm font-semibold text-slate-800 placeholder:text-slate-400 w-56"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        addSavedMed(durQuickAdd);
                        setDurQuickAdd('');
                      }}
                      className="px-3 py-1.5 rounded-2xl bg-white border border-subtle text-xs font-black text-slate-700 hover:bg-slate-50 transition"
                    >
                      추가
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={runDurCheck}
                    disabled={durLoading || savedMeds.length < 2}
                    className="px-4 py-2.5 rounded-3xl bg-slate-900 text-white font-semibold shadow-soft hover:opacity-95 transition disabled:opacity-60"
                    title={savedMeds.length < 2 ? '2개 이상 추가해야 해요' : '병용 금기 확인'}
                  >
                    {durLoading ? '확인 중…' : '병용 금기 확인'}
                  </button>
                  <button
                    type="button"
                    onClick={clearSavedMeds}
                    className="px-4 py-2.5 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    전체 삭제
                  </button>
                </div>
              </div>

              {savedMeds.length === 0 ? (
                <div className="mt-5 rounded-4xl border border-subtle bg-slate-50 p-5">
                  <div className="text-sm font-black text-slate-900">복용 목록이 비어 있어요</div>
                  <div className="mt-1 text-sm text-slate-600 font-medium leading-relaxed">
                    검색 결과에서 추가하거나, 위 입력칸에 약 이름을 입력해 목록을 만들어보세요.
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {savedMeds.map((n) => (
                    <div key={n} className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-50 border border-subtle">
                      <div className="text-sm font-semibold text-slate-800">{n}</div>
                      <button
                        type="button"
                        onClick={() => removeSavedMed(n)}
                        className="text-xs font-black text-slate-500 hover:text-slate-900"
                        title="삭제"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {durError && (
                <div className="mt-5 rounded-4xl border border-rose-200 bg-rose-50/60 p-5">
                  <div className="text-sm font-black text-rose-800">확인할 수 없어요</div>
                  <div className="mt-1 text-sm font-semibold text-rose-800 leading-relaxed">{durError}</div>
                  {durStatus.available === false && (
                    <div className="mt-3 text-xs text-red-700/80 font-semibold">
                      팁: 백엔드의 [backend/.env](backend/.env)에서 `DUR_SERVICE_PATH`와 `ODCLOUD_SERVICE_KEY`를 확인해보세요.
                    </div>
                  )}
                </div>
              )}

              {/* Results */}
              {!durLoading && !durError && savedMeds.length >= 2 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black text-slate-900">검사 결과</div>
                    <div className="text-xs font-black text-slate-500">
                      {durResults.length > 0 ? `위험 조합 ${durResults.length}개` : '금기 조합 없음'}
                    </div>
                  </div>

                  {durResults.length === 0 ? (
                    <>
                      <div className="mt-3 rounded-4xl border border-subtle bg-slate-50 p-5">
                        <div className="text-sm font-black text-slate-900">특이 사항이 발견되지 않았어요</div>
                        <div className="mt-1 text-sm text-slate-600 font-medium leading-relaxed">
                          모든 상호작용을 완전히 보장하진 않아요. 불안하거나 증상이 있으면 의사/약사에게 상담해주세요.
                        </div>
                      </div>
                      <div className="mt-5 rounded-4xl border-2 border-yellow-300 bg-yellow-50/80 p-5 shadow-lg animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex items-start gap-3">
                          <div className="pt-1">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-yellow-100 text-yellow-700 border border-yellow-200">
                              ⚠️ 주의사항
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-black text-yellow-900 mb-1">임상적으로 주의가 필요한 조합</div>
                            {cautionWarnings.length > 0 ? (
                              cautionWarnings.map((w, i) => (
                                <div key={i} className="mb-2 p-2 rounded-xl border border-yellow-200 bg-yellow-50">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-bold text-yellow-900">{w.med}</span>
                                    <span className="text-xs font-semibold text-yellow-700 bg-yellow-200 rounded px-2 py-0.5">주의 약물: {w.kw}</span>
                                  </div>
                                  {w.reason && (
                                    <div className="text-xs text-yellow-900 font-bold mb-1">이유: {w.reason}</div>
                                  )}
                                  <div className="text-xs text-yellow-800 font-semibold leading-relaxed">
                                    {w.caution}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="mb-1 text-xs text-yellow-800 font-semibold leading-relaxed">
                                주의사항 없음
                              </div>
                            )}
                            <div className="mt-2 text-xs text-yellow-700/80 font-semibold">
                              DUR(병용금기) 데이터에 없더라도, 아래 약물 조합은 실제로 임상적 주의가 필요할 수 있습니다.<br />
                              의사/약사와 반드시 상담하세요.
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 rounded-4xl border border-subtle overflow-hidden bg-white">
                      {durResults.slice(0, 10).map((it, idx) => {
                        const left = String(it?.left || '').trim();
                        const right = String(it?.right || '').trim();
                        const reason = String(it?.reason || '병용 금기(사유 정보 없음)').trim();
                        const isLast = idx === Math.min(durResults.length, 10) - 1;

                        return (
                          <button
                            key={`${idx}-${left}-${right}`}
                            type="button"
                            onClick={() => openDurSheet(it)}
                            className={
                              `w-full text-left px-4 py-3 hover:bg-slate-50/70 active:bg-slate-50 transition flex items-start gap-3 ` +
                              (!isLast ? 'border-b border-subtle' : '')
                            }
                          >
                            <div className="pt-0.5">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-700 border border-subtle">
                                주의
                              </span>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-black text-slate-900 truncate">{left} × {right}</div>
                              <div className="mt-0.5 text-xs text-slate-500 font-semibold truncate">{reason}</div>
                            </div>

                            <div className="text-slate-400 font-black leading-none select-none">›</div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {durResults.length > 10 && (
                    <div className="mt-3 text-xs text-slate-500 font-semibold">
                      결과가 많아 상위 10개만 표시했어요.
                    </div>
                  )}
                </div>
              )}

              {/* Bottom Sheet (Apple-like) */}
              {durSheetMounted && (
                <div className="fixed inset-0 z-[60]">
                  <button
                    type="button"
                    aria-label="Close"
                    className={
                      'absolute inset-0 backdrop-blur-sm transition-opacity duration-200 ease-out ' +
                      (durSheetVisible ? 'opacity-100 bg-slate-900/25' : 'opacity-0 bg-slate-900/0')
                    }
                    onClick={closeDurSheet}
                  />

                  <div className="absolute inset-x-0 bottom-0">
                    <div className="mx-auto max-w-2xl">
                      <div
                        className={
                          'rounded-t-4xl border border-subtle bg-white shadow-[0_-20px_60px_rgba(15,23,42,0.14)] transform transition-transform duration-200 ease-out ' +
                          (durSheetVisible ? 'translate-y-0' : 'translate-y-8')
                        }
                      >
                        <div className="px-5 pt-4 pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-700 border border-subtle">
                                  주의
                                </span>
                                <div className="text-sm font-black text-slate-900 truncate">
                                  {String(durSelectedHit?.left || '').trim()} × {String(durSelectedHit?.right || '').trim()}
                                </div>
                              </div>
                              <div className="mt-2 text-sm text-slate-700 font-semibold leading-relaxed">
                                {String(durSelectedHit?.reason || '병용 금기(사유 정보 없음)').trim()}
                              </div>
                              {(durSelectedHit?.ingredientA || durSelectedHit?.ingredientB) && (
                                <div className="mt-2 text-xs text-slate-500 font-semibold">
                                  성분: {String(durSelectedHit?.ingredientA || '').trim()}
                                  {durSelectedHit?.ingredientB ? ` / ${String(durSelectedHit?.ingredientB || '').trim()}` : ''}
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={closeDurSheet}
                              className="px-3 py-2 rounded-2xl border border-subtle bg-white text-xs font-black text-slate-700 hover:bg-slate-50 transition"
                            >
                              닫기
                            </button>
                          </div>
                        </div>

                        <div className="px-5 pb-5">
                          <div className="rounded-4xl border border-subtle bg-slate-50 p-4">
                            <details>
                              <summary className="cursor-pointer text-xs font-black text-slate-600 hover:text-slate-900">
                                세부 데이터
                              </summary>
                              <div className="mt-3 rounded-3xl bg-white border border-subtle p-3 text-xs text-slate-700 font-mono overflow-auto max-h-64">
                                {JSON.stringify(durSelectedHit?.raw || durSelectedHit || {}, null, 2)}
                              </div>
                            </details>
                          </div>

                          <div className="mt-4 text-xs text-slate-500 font-semibold leading-relaxed">
                            참고: 본 결과는 공개 데이터 기반의 참고 정보이며, 최종 판단은 의사/약사와 상의해주세요.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>


      {/* ...existing code... */}


      {/* 4. 이미지 식별 섹션 (Step 2 적용) */}
      <section id="image" className="py-14 md:py-16 px-6">
        <div className="mx-auto max-w-7xl">
          <div>
            <div>
              <div className="rounded-4xl p-8 md:p-12 border border-subtle surface apple-shadow">
                <div className="mb-8 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-black text-slate-400 uppercase tracking-tighter">다음 단계</div>
                    <div className="mt-1 text-xl font-black text-slate-900">사진/OCR로 확인하기</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="hidden sm:inline-flex px-4 py-2 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    결과 다시 보기
                  </button>
                </div>
                <div className="flex flex-col md:flex-row items-center gap-12">
                  <div className="flex-1">
              <h3 className="text-2xl font-black mb-4">사진으로 약 찾기</h3>
              <p className="text-slate-600 font-medium mb-6 leading-relaxed">
                약을 분실했거나 이름을 모를 때, 사진을 올리면 AI가 형태와 색상을 분석해 가장 유사한 약을 찾아줍니다.
              </p>
              <div className="flex gap-3">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-subtle text-xs font-semibold text-slate-700">
                  <span className="text-medic-main">●</span> 캡슐/정제 구분
                </span>
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-subtle text-xs font-semibold text-slate-700">
                  <span className="text-medic-main">●</span> 색상/각인 분석
                </span>
              </div>
                  </div>

                  <div className="flex-1 w-full">
              {/* 숨김 입력: 파일 업로드(갤러리/파일) */}
              <input
                ref={uploadInputRef}
                type="file"
                className="hidden"
                onChange={handleImageChange}
                accept="image/*"
              />
              {/* 숨김 입력: 카메라 촬영(모바일에서 카메라 UI 우선) */}
              <input
                ref={cameraInputRef}
                type="file"
                className="hidden"
                onChange={handleImageChange}
                accept="image/*"
                capture="environment"
              />

              <div className="w-full rounded-4xl border border-dashed border-slate-200 bg-white/80 overflow-hidden">
                <div className="h-64 flex items-center justify-center">
                  {selectedImage ? (
                    <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center px-6">
                      <span className="text-4xl mb-3 block">📸</span>
                      <p className="text-slate-700 font-bold">사진을 선택하거나 촬영하세요</p>
                      <p className="mt-1 text-xs text-slate-500">모바일: “카메라로 촬영”을 누르면 카메라가 열려요.</p>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-white/70">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      className="px-4 py-2.5 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      갤러리/파일 선택
                    </button>
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="px-4 py-2.5 rounded-3xl bg-slate-900 text-white font-semibold shadow-soft hover:opacity-95 transition"
                    >
                      카메라로 촬영
                    </button>
                    <button
                      type="button"
                      onClick={openWebcam}
                      className="hidden md:inline-flex px-4 py-2.5 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                      title="데스크톱/노트북에서 웹캠으로 촬영"
                    >
                      웹캠으로 촬영(PC)
                    </button>
                    {selectedFile && (
                      <div className="ml-auto text-xs font-semibold text-slate-500 truncate max-w-[18rem]">
                        {selectedFile.name}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAnalyzeOcr}
                  disabled={ocrLoading}
                  className="px-4 py-2.5 rounded-3xl bg-slate-900 text-white font-semibold shadow-soft hover:opacity-95 transition disabled:opacity-60"
                >
                  {ocrLoading ? '분석 중…' : 'OCR로 텍스트 추출'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetImageState();
                  }}
                  className="px-4 py-2.5 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  초기화
                </button>
              </div>

              {ocrLines.length > 0 && (
                <div className="mt-4 rounded-4xl border border-subtle bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black text-slate-900">추출된 텍스트</div>
                    <div className="text-[11px] font-semibold text-slate-500">클릭하면 의약품 검색으로 연결돼요</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ocrLines.slice(0, 10).map((line, idx) => {
                      const t = String(line || '').trim();
                      if (!t) return null;
                      return (
                        <button
                          key={`${idx}-${t}`}
                          type="button"
                          onClick={() => {
                            setSearchTerm(t);
                            handleSearch(t);
                          }}
                          className="px-3 py-2 rounded-2xl border border-subtle bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-white transition"
                          title="클릭해서 이 텍스트로 검색"
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 데스크톱 웹캠 촬영 모달: 모바일 capture 흐름과 분리 */}
      {isWebcamOpen && (
        <div className="fixed inset-0 z-[70] px-4 py-8 flex items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="닫기"
            onClick={closeWebcam}
          />

          <div className="relative w-full max-w-3xl rounded-4xl border border-subtle surface apple-shadow overflow-hidden">
            <div className="p-5 md:p-6 flex items-center justify-between gap-3 border-b border-slate-100">
              <div>
                <div className="text-xs font-black text-slate-400 uppercase tracking-tighter">웹캠 촬영</div>
                <div className="mt-1 text-lg font-black text-slate-900">프레임을 맞춘 뒤 캡처하세요</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleWebcamMode}
                  className="px-4 py-2 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                  disabled={webcamStarting}
                  title="전면/후면 카메라 전환(지원되는 기기에서만 동작)"
                >
                  전환
                </button>
                <button
                  type="button"
                  onClick={closeWebcam}
                  className="px-4 py-2 rounded-3xl bg-slate-900 text-white font-semibold shadow-soft hover:opacity-95 transition"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="p-5 md:p-6">
              {webcamError && (
                <div className="mb-4 rounded-3xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {webcamError}
                </div>
              )}

              <div className="rounded-4xl overflow-hidden border border-slate-100 bg-black">
                <div className="aspect-video w-full">
                  <video
                    ref={webcamVideoRef}
                    className="w-full h-full object-contain"
                    playsInline
                    muted
                    autoPlay
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => startWebcam()}
                  disabled={webcamStarting}
                  className="px-4 py-2.5 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-60"
                >
                  {webcamStarting ? '시작 중…' : '다시 연결'}
                </button>
                <button
                  type="button"
                  onClick={captureWebcamFrame}
                  className="px-4 py-2.5 rounded-3xl bg-slate-900 text-white font-semibold shadow-soft hover:opacity-95 transition"
                >
                  캡처
                </button>
                <div className="ml-auto text-xs font-semibold text-slate-500">
                  모드: {webcamMode === 'environment' ? '후면(권장)' : '전면'}
                </div>
              </div>

              <canvas ref={webcamCanvasRef} className="hidden" />
            </div>
          </div>
        </div>
      )}


      {/* ...existing code... */}

      {/* 약국 찾기(PharmacySearch) 섹션을 서비스 소개 바로 위에 배치 */}
      <section id="pharmacy" className="py-16 md:py-20 px-6 pharmacy-bg">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl md:text-4xl font-extrabold text-medic-main mb-2 flex items-center justify-center gap-2">
              <span className="inline-block bg-medic-main/10 rounded-full px-3 py-1 text-medic-main">🏥</span>
              주변 약국 찾기
            </h2>
            <p className="text-slate-600 text-lg font-medium mt-2">
              내 위치 또는 지역명으로 가까운 약국을 쉽고 빠르게 검색하세요.
            </p>
          </div>
          <div className="rounded-3xl border border-subtle bg-white/80 shadow-xl p-6 md:p-8">
            <PharmacySearch />
          </div>
        </div>
      </section>

      {pharmacyMapOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-3xl rounded-4xl bg-white border border-subtle apple-shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-subtle flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-slate-900 truncate">
                  {String(
                    pharmacyMapTarget?.name ?? pharmacyMapTarget?.place_name ?? pharmacyMapTarget?.placeName ?? '약국',
                  ).trim() || '약국'}{' '}
                  지도
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {String(
                    pharmacyMapTarget?.address ?? pharmacyMapTarget?.address_name ?? pharmacyMapTarget?.addressName ?? '',
                  ).trim()}
                </div>
              </div>
              <button
                type="button"
                onClick={_closePharmacyMap}
                className="px-4 py-2 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                닫기
              </button>
            </div>

            <div className="p-6">
                {pharmacyMapState.loading ? (
                  <div className="text-sm font-semibold text-slate-600">지도 불러오는 중…</div>
                ) : pharmacyMapState.error ? (
                  <div className="text-sm font-semibold text-red-600">{pharmacyMapState.error}</div>
                ) : pharmacyMapState.lat && pharmacyMapState.lon ? (
                  <PharmacyMap
                    lat={pharmacyMapState.lat}
                    lon={pharmacyMapState.lon}
                    markers={pharmacyMapTarget ? [{ lat: pharmacyMapState.lat, lon: pharmacyMapState.lon, label: pharmacyMapTarget.name || pharmacyMapTarget.약국명 || '약국' }] : []}
                    height={360}
                  />
                ) : (
                  <div className="text-sm font-semibold text-slate-600">표시할 좌표가 없어요. 약국 주소가 정확하지 않거나, 데이터에 좌표 정보가 누락된 경우입니다.<br/>검색어를 더 구체적으로 입력하거나 다른 결과를 선택해보세요.</div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* 4. 서비스 소개 (About 섹션) */}
      <section id="about" className="py-20 px-6">
        <div className="mx-auto max-w-7xl">
          <div>
            <div>
              <div className="text-center mb-16">
                <h2 className="text-3xl font-black mb-4">왜 MedicLens 인가요?</h2>
                <div className="w-16 h-1.5 bg-gradient-to-r from-cyan-600 to-emerald-500 mx-auto rounded-full"></div>
              </div>
              <div className="grid md:grid-cols-3 gap-8 text-center">
                {[
                  { title: '신뢰성', desc: '식약처 및 약학정보원 데이터를 실시간으로 반영합니다.', icon: '🛡️' },
                  { title: '편의성', desc: '복잡한 의학 용어를 쉬운 일상 언어로 풀어서 설명합니다.', icon: '💡' },
                  { title: '안전성', desc: '함께 복용하면 안 되는 약 조합을 즉시 경고해 드립니다.', icon: '🚫' },
                ].map((item, i) => (
                  <div key={i} className="p-10 rounded-4xl bg-white/80 glass border border-subtle apple-shadow hover:shadow-soft transition-all">
                    <div className="text-4xl mb-6">{item.icon}</div>
                    <h4 className="text-xl font-bold mb-3">{item.title}</h4>
                    <p className="text-slate-600 leading-relaxed text-sm font-medium">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Dev-only diagnostics badge (never shown in production build) */}
      {isDev && (
        <div className="fixed bottom-5 right-5 z-[80] hidden md:block pointer-events-none">
          <div className="pointer-events-auto rounded-3xl border border-subtle bg-white/80 glass apple-shadow px-4 py-3 text-xs text-slate-700 w-[22rem]">
            <div className="flex items-center justify-between">
              <div className="font-black text-slate-900">DEV 연결 상태</div>
              <div className="text-[10px] text-slate-500">{devDiag.checkedAt ? devDiag.checkedAt.slice(11, 19) : ''}</div>
            </div>
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between gap-3">
                <div className="text-slate-500">Origin</div>
                <div className="font-semibold truncate max-w-[14rem]">{devDiag.origin || '-'}</div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-slate-500">Flask</div>
                <div className="font-semibold">
                  {devDiag.flask.ok === null ? '…' : devDiag.flask.ok ? `OK (${devDiag.flask.status})` : `FAIL (${devDiag.flask.status ?? '—'})`}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-slate-500">약국 API</div>
                <div className="font-semibold">
                  {devDiag.pharmacy.ok === null
                    ? '…'
                    : devDiag.pharmacy.ok
                      ? devDiag.pharmacy.available
                        ? '사용 가능'
                        : '준비 중'
                      : `FAIL (${devDiag.pharmacy.status ?? '—'})`}
                </div>
              </div>
              <div className="text-[10px] text-slate-500">
                reqId: {devDiag.pharmacy.requestId || devDiag.flask.requestId || '-'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
};

export default MainPage;