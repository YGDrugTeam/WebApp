import React from 'react';
import MainPage from './pages/MainPage'; // MainPage 컴포넌트를 가져옵니다.
import PharmacyFinder from './components/PharmacyFinder';

function App() {
  return (
    <div className="App">
      {/* 우리가 공들여 만든 메인 페이지를 여기서 렌더링합니다. */}
      <MainPage />
    </div>
  );
}

export default App;