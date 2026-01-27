import React, { useEffect, useMemo, useRef, useState } from 'react';

const MainPage = () => {
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
  const [geo, setGeo] = useState({ enabled: false, lat: null, lon: null, accuracy: null });
  const [radiusKm, setRadiusKm] = useState(2);
  const [geoLoading, setGeoLoading] = useState(false);
  const [pharmacySort, setPharmacySort] = useState('relevance'); // relevance | distance
  const [pharmacyAvailable, setPharmacyAvailable] = useState(null); // null | boolean

  const isDev = Boolean(import.meta?.env?.DEV);
  const [devDiag, setDevDiag] = useState({
    checkedAt: null,
    origin: '',
    flask: { ok: null, status: null, requestId: null },
    pharmacy: { ok: null, available: null, code: null, status: null, requestId: null },
  });

  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [ocrLines, setOcrLines] = useState([]);
  const [ocrLoading, setOcrLoading] = useState(false);

  const [filters, setFilters] = useState({
    pregnancy: false,
    drowsy: false,
    alcohol: false,
  });

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter(Boolean).length,
    [filters],
  );

  const FLASK_BASE = String(import.meta?.env?.VITE_FLASK_BASE || '').trim().replace(/\/$/, '');
  const FASTAPI_BASE = String(import.meta?.env?.VITE_FASTAPI_BASE || '').trim().replace(/\/$/, '');

  // --- 함수 (Functions) ---
  // 텍스트 검색 처리
  const handleSearch = async (termOverride) => {
    const term = (termOverride ?? searchTerm).trim();
    setErrorMessage('');
    setInfoMessage('');
    setLoading(true);
    try {
      if (!term) {
        setResults([]);
        setErrorMessage('검색어를 입력해주세요.');
        return;
      }

      // Flask: GET /search?name=...
      const url = FLASK_BASE
        ? `${FLASK_BASE}/search?name=${encodeURIComponent(term)}`
        : `/api/search?name=${encodeURIComponent(term)}`;

      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.status !== 'success') {
        setResults([]);
        setErrorMessage(data?.message || '검색 결과를 찾지 못했어요.');
        return;
      }

      setResults([data.data]);
      setInfoMessage('검색 결과를 불러왔어요.');

      // 결과 섹션으로 자연스럽게 이동
      setTimeout(() => {
        document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (error) {
      console.error(error);
      setResults([]);
      setErrorMessage(
        FLASK_BASE
          ? '서버에 연결할 수 없어요. VITE_FLASK_BASE 주소/포트를 확인해주세요.'
          : '서버에 연결할 수 없어요. Vite 개발 서버와 Flask(5000)가 모두 실행 중인지 확인해주세요.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePharmacySearch = async (qOverride) => {
    const q = (qOverride ?? pharmacyQuery).trim();
    setPharmacyError('');
    setErrorMessage('');
    setInfoMessage('');
    setPharmacyLoading(true);
    try {
      if (pharmacyAvailable === false) {
        setPharmacyResults([]);
        return;
      }

      if (!q) {
        setPharmacyResults([]);
        setPharmacyError('지역/약국명을 입력해주세요.');
        return;
      }

      const base = FLASK_BASE ? `${FLASK_BASE}/pharmacies` : '/api/pharmacies';
      const params = new URLSearchParams({ q, limit: '10', sort: pharmacySort });
      if (geo.enabled && geo.lat != null && geo.lon != null) {
        params.set('lat', String(geo.lat));
        params.set('lon', String(geo.lon));
        params.set('radius_km', String(radiusKm));
      }
      const url = `${base}?${params.toString()}`;

      const response = await fetch(url);
      const requestId = response.headers.get('x-request-id') || response.headers.get('X-Request-Id');
      const rawText = await response.text().catch(() => '');
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }

      if (!response.ok || data?.status !== 'success') {
        setPharmacyResults([]);

        const code = String(data?.code || '').trim();
        const serverMsg = String(data?.message || '').trim();
        const friendly =
          code === 'PHARMACY_NOT_CONFIGURED'
            ? '현재 약국 찾기 기능을 이용할 수 없어요.'
            : code === 'PHARMACY_UPSTREAM_ERROR'
              ? '약국 데이터를 불러오는 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.'
              : '약국 정보를 불러오지 못했어요.';

        if (code === 'PHARMACY_NOT_CONFIGURED') {
          setPharmacyAvailable(false);
          disableGeolocation();
        }

        // 개발자용 디버그는 콘솔로만 남김 (사용자 UI 노출 금지)
        console.warn('pharmacies api error', {
          status: response.status,
          requestId,
          rawText,
        });
        setPharmacyError(friendly);
        return;
      }

      const items = Array.isArray(data?.data) ? data.data : [];
      setPharmacyResults(items);
      setInfoMessage(items.length ? '약국 정보를 불러왔어요.' : '검색 결과가 없어요. 키워드를 바꿔보세요.');

      setTimeout(() => {
        document.getElementById('pharmacy')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (e) {
      console.error(e);
      setPharmacyResults([]);
      setPharmacyError(
        FLASK_BASE
          ? '서버에 연결할 수 없어요. VITE_FLASK_BASE 주소/포트를 확인해주세요.'
          : '서버에 연결할 수 없어요. Vite 개발 서버와 Flask(5000)가 모두 실행 중인지 확인해주세요.',
      );
    } finally {
      setPharmacyLoading(false);
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
            if (!data.available) disableGeolocation();
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
        setPharmacyError('이 브라우저는 위치 기능을 지원하지 않아요.');
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
      setPharmacyError('위치 권한을 허용해야 반경 검색을 사용할 수 있어요.');
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
    setOcrLines([]);

    if (!selectedFile) {
      setErrorMessage('먼저 이미지를 업로드해주세요.');
      return;
    }

    setOcrLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      // FastAPI: POST /analyze/ocr?user_id=...
      const url = FASTAPI_BASE ? `${FASTAPI_BASE}/analyze/ocr?user_id=demo` : '/ml/analyze/ocr?user_id=demo';
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErrorMessage(data?.detail || 'OCR 분석에 실패했어요.');
        return;
      }

      const lines = Array.isArray(data?.detected_text) ? data.detected_text : [];
      setOcrLines(lines);
      setInfoMessage(lines.length ? '텍스트를 추출했어요.' : '추출된 텍스트가 없어요.');

      setTimeout(() => {
        document.getElementById('image')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        FASTAPI_BASE
          ? '서버에 연결할 수 없어요. VITE_FASTAPI_BASE 주소/포트를 확인해주세요.'
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
              <a href="#" className="hover:text-slate-900 transition">상호작용</a>
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
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-bold text-slate-900">상세 필터</div>
                            <button
                              type="button"
                              onClick={() => setFilters({ pregnancy: false, drowsy: false, alcohol: false })}
                              className="text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
                            >
                              초기화
                            </button>
                          </div>
                          <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
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
                  {['타이레놀', '이부프로펜', '감기약', '알레르기'].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        setSearchTerm(chip);
                        handleSearch(chip);
                      }}
                      className="px-3 py-1.5 rounded-full bg-white/70 glass border border-subtle text-slate-700 font-semibold hover:bg-white transition"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
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
      </section>

      {/* 검색 결과 상세 섹션: 검색 바로 아래에 표시 */}
      {primaryResult && (
        <section id="results" className="px-6 -mt-6 md:-mt-10 pb-14 md:pb-16 animate-in fade-in slide-in-from-bottom-5 duration-700">
          <div className="mx-auto max-w-7xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-sm font-black text-slate-900">검색 결과</div>
              <button
                type="button"
                onClick={() => document.getElementById('search')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
              >
                검색으로 돌아가기
              </button>
            </div>
            <div className="rounded-4xl border border-subtle overflow-hidden surface apple-shadow">
              {/* 상단 타이틀 바 */}
              <div className="p-8 text-white relative bg-gradient-to-r from-slate-950 to-slate-900">
                <div className="absolute top-8 right-8 bg-white/10 px-4 py-1 rounded-full text-xs font-black">식약처 인증 데이터</div>
                <h3 className="text-3xl font-black mb-2">{resultName || '검색 결과'}</h3>
                <p className="text-slate-200 font-semibold">{resultCompany}</p>
              </div>

              {/* 상세 정보 그리드 */}
              <div className="p-8 md:p-12 grid md:grid-cols-2 gap-12">
                {/* 왼쪽: 외형 및 주의사항 */}
                <div className="space-y-8">
                  <div>
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-tighter mb-4">제품 외형 설명</h4>
                    <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                      <p className="text-slate-800 font-semibold leading-relaxed">{resultChart || '외형 정보가 없습니다.'}</p>
                    </div>
                  </div>

                  {(resultIngredient || resultCategory) && (
                    <div className="rounded-4xl border border-subtle bg-white p-6">
                      <div className="text-xs font-black text-slate-400 uppercase tracking-tighter mb-4">핵심 정보</div>
                      <div className="grid gap-3 text-sm">
                        {resultIngredient && (
                          <div className="flex items-start justify-between gap-4">
                            <div className="font-bold text-slate-900">성분</div>
                            <div className="text-slate-600 text-right">{resultIngredient}</div>
                          </div>
                        )}
                        {resultCategory && (
                          <div className="flex items-start justify-between gap-4">
                            <div className="font-bold text-slate-900">분류</div>
                            <div className="text-slate-600 text-right">{resultCategory}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-tighter mb-4">복용 시 주의사항</h4>
                    <div className="flex flex-wrap gap-2">
                      <span className="bg-red-50 text-red-500 px-4 py-2 rounded-xl text-xs font-bold border border-red-100">🚫 음주 금지</span>
                      <span className="bg-orange-50 text-orange-500 px-4 py-2 rounded-xl text-xs font-bold border border-orange-100">⚠️ 빈속 복용 주의</span>
                      <span className="bg-blue-50 text-blue-500 px-4 py-2 rounded-xl text-xs font-bold border border-blue-100">💤 졸음 유발</span>
                    </div>
                  </div>
                </div>

                {/* 오른쪽: 효능 및 용법 */}
                <div className="space-y-8">
                  <div className="relative pl-6 border-l-4 border-cyan-400">
                    <h5 className="font-black text-lg text-slate-800">효능 효과</h5>
                    <p className="text-slate-500 mt-2 text-sm leading-relaxed">
                      두통, 치통, 발치 후 통증, 인후통, 귀의 통증, 관절통, 신경통, 요통, 근육통, 견통(어깨결림), 타박통, 골절통, 생리통(월경통), 외상통의 진통
                    </p>
                  </div>
                  <div className="relative pl-6 border-l-4 border-emerald-400">
                    <h5 className="font-black text-lg text-slate-800">용법 용량</h5>
                    <p className="text-slate-500 mt-2 text-sm leading-relaxed">
                      성인 1회 1~2정씩, 1일 3~4회 (4~6시간 간격) 공복을 피하여 복용합니다. 하루 최대 4g을 초과하지 마십시오.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 3. 이미지 식별 섹션 (Step 2 적용) */}
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
                  <div className="text-sm font-black text-slate-900">추출된 텍스트</div>
                  <div className="mt-2 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {ocrLines.slice(0, 10).map((line, idx) => (
                      <div key={`${idx}-${line}`}>{line}</div>
                    ))}
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

      {/* 3.5 약국 찾기 */}
      <section id="pharmacy" className="py-14 md:py-16 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-4xl p-8 md:p-12 border border-subtle surface apple-shadow">
            <div className="mb-8 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-black text-slate-400 uppercase tracking-tighter">편의 기능</div>
                <div className="mt-1 flex items-center gap-3">
                  <div className="text-xl font-black text-slate-900">약국 찾기</div>
                  {pharmacyAvailable === false && (
                    <span className="px-3 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-600">
                      준비 중
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-600 font-medium">
                  지역/지하철역/도로명/약국명으로 검색하세요. (실데이터만 제공)
                </p>
              </div>
              <button
                type="button"
                onClick={() => document.getElementById('search')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="hidden sm:inline-flex px-4 py-2 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                검색으로
              </button>
            </div>

            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 px-3 md:px-4 py-3 rounded-3xl bg-white border border-subtle">
                  <span className="text-slate-400">📍</span>
                  <input
                    type="text"
                    value={pharmacyQuery}
                    onChange={(e) => setPharmacyQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePharmacySearch()}
                    className="w-full bg-transparent outline-none text-slate-900 placeholder:text-slate-400 font-medium"
                    placeholder="예: 강남역 약국, 서초구, 논현로…"
                    disabled={pharmacyAvailable === false}
                  />
                </div>
                {pharmacyError && <div className="mt-2 text-sm font-semibold text-red-600">{pharmacyError}</div>}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePharmacySearch}
                  className="px-6 py-3 rounded-3xl bg-slate-900 text-white font-semibold shadow-soft hover:opacity-95 transition"
                  disabled={pharmacyAvailable === false}
                >
                  {pharmacyLoading ? '검색 중…' : '검색'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPharmacyQuery('');
                    setPharmacyResults([]);
                    setPharmacyError('');
                    disableGeolocation();
                  }}
                  className="px-6 py-3 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  초기화
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {!geo.enabled ? (
                  <button
                    type="button"
                    onClick={requestGeolocation}
                    className="px-4 py-2.5 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                    disabled={geoLoading || pharmacyAvailable === false}
                  >
                    {geoLoading ? '위치 확인 중…' : '내 위치 사용'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={disableGeolocation}
                    className="px-4 py-2.5 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    위치 해제
                  </button>
                )}
                <div className="text-xs text-slate-500">
                  {geo.enabled && geo.lat != null && geo.lon != null
                    ? `위치 활성화됨 (정확도 ±${geo.accuracy ? Math.round(geo.accuracy) : '?'}m)`
                    : '위치 미사용: 키워드 기반 검색만'}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 md:ml-auto">
                <div className="inline-flex rounded-3xl border border-subtle bg-white overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setPharmacySort('relevance')}
                    className={
                      pharmacySort === 'relevance'
                        ? 'px-4 py-2.5 text-xs font-black text-white bg-slate-900'
                        : 'px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50'
                    }
                    aria-pressed={pharmacySort === 'relevance'}
                    title="키워드(텍스트) 유사도 우선"
                    disabled={pharmacyAvailable === false}
                  >
                    키워드 우선
                  </button>
                  <button
                    type="button"
                    onClick={() => setPharmacySort('distance')}
                    className={
                      pharmacySort === 'distance'
                        ? 'px-4 py-2.5 text-xs font-black text-white bg-slate-900'
                        : 'px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50'
                    }
                    aria-pressed={pharmacySort === 'distance'}
                    title="거리 우선(위치가 있을 때만 효과)"
                    disabled={pharmacyAvailable === false}
                  >
                    거리 우선
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-xs font-semibold text-slate-600">반경</div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(Number(e.target.value))}
                    className="w-44"
                    disabled={!geo.enabled}
                  />
                  <div className="text-xs font-black text-slate-900 w-10 text-right">{radiusKm}km</div>
                </div>
              </div>
            </div>

            {pharmacyResults.length > 0 && (
              <div className="mt-6 grid md:grid-cols-2 gap-4">
                {pharmacyResults.slice(0, 10).map((p, idx) => {
                  const name = String(p?.name || '').trim();
                  const address = String(p?.address || '').trim();
                  const phone = String(p?.phone || '').trim();
                  const distanceKm = typeof p?.distance_km === 'number' ? p.distance_km : null;
                  const mapQ = encodeURIComponent(address || name);
                  const mapUrl = `https://map.naver.com/v5/search/${mapQ}`;
                  return (
                    <div key={`${idx}-${name}-${address}`} className="rounded-4xl border border-subtle bg-white p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-black text-slate-900">{name || '약국'}</div>
                            {distanceKm != null && (
                              <div className="text-xs font-bold text-slate-500">· {distanceKm.toFixed(2)}km</div>
                            )}
                          </div>
                          <div className="mt-1 text-sm text-slate-600 font-medium leading-relaxed">{address}</div>
                          {phone && <div className="mt-2 text-sm font-semibold text-slate-700">☎ {phone}</div>}
                        </div>
                        <a
                          href={mapUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 px-4 py-2 rounded-3xl border border-subtle bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
                        >
                          지도
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-6 text-xs text-slate-500">
              위치를 켜면 반경/거리 정렬이 더 정확해져요.
            </div>
          </div>
        </div>
      </section>

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

      </div>

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
  );
};
export default MainPage;