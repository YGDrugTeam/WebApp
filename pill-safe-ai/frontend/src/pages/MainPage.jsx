import React, { useState } from 'react';

const MainPage = () => {
  // --- 상태 관리 (State) ---
  const [searchTerm, setSearchTerm] = useState(''); // 텍스트 검색어
  const [results, setResults] = useState([]);      // 검색 결과 리스트
  const [loading, setLoading] = useState(false);   // 로딩 상태
  const [selectedImage, setSelectedImage] = useState(null); // 이미지 미리보기
  const [isFilterOpen, setIsFilterOpen] = useState(false); // 상세 필터 열림 여부

  // --- 함수 (Functions) ---
  // 텍스트 검색 처리
  const handleSearch = async () => {
    if (!searchTerm) return alert("검색어를 입력해주세요!");
    setLoading(true);
    try {
      // 실제 API 호출 시 여기에 fetch 로직이 들어갑니다.
      // 임시 데이터로 결과 화면 시뮬레이션
      setTimeout(() => {
        setResults([{ ITEM_NAME: '타이레놀정500mg', ENTP_NAME: '(주)한국얀센', CHART: '백색의 장방형 정제' }]);
        setLoading(false);
      }, 800);
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  };

  // 이미지 업로드 처리
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSelectedImage(reader.result);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800">
      {/* 1. 네비게이션 바 */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-cyan-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <h1 className="text-2xl font-black text-medic-main tracking-tighter">MedicLens</h1>
          <nav className="hidden md:flex space-x-8 font-bold text-slate-500 text-sm">
            <a href="#" className="hover:text-medic-main">의약품 검색</a>
            <a href="#" className="hover:text-medic-main">상호작용</a>
            <a href="#" className="hover:text-medic-main">약국 찾기</a>
            <a href="#about" className="hover:text-medic-main">서비스 소개</a>
          </nav>
          <button className="bg-medic-main text-white px-6 py-2.5 rounded-full font-bold shadow-lg shadow-cyan-100 hover:scale-105 transition">
            시작하기
          </button>
        </div>
      </header>

      {/* 2. 메인 히어로 & 검색 섹션 */}
      <section className="pt-16 pb-24 bg-gradient-to-b from-cyan-50/50 to-white px-6">
        <div className="max-w-4xl mx-auto text-center">
          <span className="inline-block px-4 py-1 bg-white border border-cyan-100 text-medic-main text-xs font-black rounded-full mb-6 shadow-sm">
            국가 공공데이터포털 연동
          </span>
          <h2 className="text-4xl md:text-5xl font-black mb-10 leading-tight">
            내 가족이 먹는 약, <br/> <span className="text-medic-main">MedicLens</span>로 확인하세요.
          </h2>

          {/* 통합 검색바 */}
          <div className="relative group max-w-3xl mx-auto">
            <input 
              type="text" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full p-6 md:p-8 rounded-4xl shadow-2xl shadow-cyan-100 border-2 border-transparent focus:border-medic-main outline-none text-lg transition-all"
              placeholder="약 이름이나 증상을 입력하세요..."
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex space-x-2">
              <button onClick={() => setIsFilterOpen(!isFilterOpen)} className="p-3 text-slate-300 hover:text-medic-main">⚙️</button>
              <button onClick={handleSearch} className="bg-medic-main text-white px-8 py-3 rounded-full font-bold shadow-lg">
                {loading ? '...' : '검색'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 이미지 식별 섹션 (Step 2 적용) */}
      <section className="max-w-5xl mx-auto py-12 px-6">
        <div className="bg-slate-50 rounded-4xl p-8 md:p-12 border border-slate-100">
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1">
              <h3 className="text-2xl font-black mb-4">사진으로 약 찾기</h3>
              <p className="text-slate-500 font-medium mb-6">약을 분실했거나 이름을 모를 때, 사진을 찍어 올리면 AI가 형태와 색상을 분석해 가장 유사한 약을 찾아줍니다.</p>
              <div className="flex gap-4">
                <div className="text-center"><div className="text-xl font-bold text-medic-main">98%</div><div className="text-xs text-slate-400">정확도</div></div>
                <div className="text-center"><div className="text-xl font-bold text-medic-main">5만+</div><div className="text-xs text-slate-400">보유 데이터</div></div>
              </div>
            </div>
            
            <div className="flex-1 w-full">
              <label className="flex flex-col items-center justify-center w-full h-64 border-4 border-dashed border-slate-200 rounded-4xl bg-white hover:bg-cyan-50 hover:border-medic-main transition-all cursor-pointer overflow-hidden">
                {selectedImage ? (
                  <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center">
                    <span className="text-4xl mb-4 block">📸</span>
                    <p className="text-slate-500 font-bold">사진 업로드 / 촬영</p>
                  </div>
                )}
                <input type="file" className="hidden" onChange={handleImageChange} accept="image/*" />
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* 4. 서비스 소개 (About 섹션) */}
      <section id="about" className="max-w-7xl mx-auto py-24 px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-black mb-4">왜 MedicLens 인가요?</h2>
          <div className="w-16 h-1.5 bg-medic-main mx-auto rounded-full"></div>
        </div>
        <div className="grid md:grid-cols-3 gap-8 text-center">
          {[
            { title: '신뢰성', desc: '식약처 및 약학정보원 데이터를 실시간으로 반영합니다.', icon: '🛡️' },
            { title: '편의성', desc: '복잡한 의학 용어를 쉬운 일상 언어로 풀어서 설명합니다.', icon: '💡' },
            { title: '안전성', desc: '함께 복용하면 안 되는 약 조합을 즉시 경고해 드립니다.', icon: '🚫' },
          ].map((item, i) => (
            <div key={i} className="p-10 rounded-4xl bg-white border border-slate-50 shadow-sm hover:shadow-xl transition-all">
              <div className="text-4xl mb-6">{item.icon}</div>
              <h4 className="text-xl font-bold mb-3">{item.title}</h4>
              <p className="text-slate-500 leading-relaxed text-sm font-medium">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

{/* 검색 결과 상세 섹션 (Phase 3) */}
{results.length > 0 && (
  <section className="max-w-5xl mx-auto px-6 mb-24 animate-in fade-in slide-in-from-bottom-5 duration-700">
    <div className="bg-white rounded-4xl border-2 border-cyan-100 overflow-hidden shadow-2xl shadow-cyan-100/50">
      {/* 상단 타이틀 바 */}
      <div className="bg-medic-main p-8 text-white relative">
        <div className="absolute top-8 right-8 bg-white/20 px-4 py-1 rounded-full text-xs font-black">식약처 인증 데이터</div>
        <h3 className="text-3xl font-black mb-2">{results[0].ITEM_NAME}</h3>
        <p className="text-cyan-50 font-bold">{results[0].ENTP_NAME}</p>
      </div>
      
      {/* 상세 정보 그리드 */}
      <div className="p-8 md:p-12 grid md:grid-cols-2 gap-12">
        {/* 왼쪽: 외형 및 주의사항 */}
        <div className="space-y-8">
          <div>
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-tighter mb-4">제품 외형 설명</h4>
            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
              <p className="text-slate-700 font-bold leading-relaxed">{results[0].CHART}</p>
            </div>
          </div>
          
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
  </section>
)}

export default MainPage;