import React from 'react';
import MainPage from './pages/MainPage'; // MainPage 컴포넌트를 가져옵니다.

// 에러 발생 원인: 아래 const App 선언이 두 번 되어 있었을 것입니다.
// 하나로 통합하여 해결합니다.
function App() {
  return (
    <div className="App">
      {/* 우리가 공들여 만든 메인 페이지를 여기서 렌더링합니다. */}
      <MainPage />
    </div>
  );
}

export default App;