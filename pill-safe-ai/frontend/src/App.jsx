// App.jsx (이미 작성하신 것처럼)
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainPage from "./pages/MainPage.jsx";
import PharmacySearch from './components/PharmacySearch';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/pharmacy" element={<PharmacySearch />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;