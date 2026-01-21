import React, { useState } from 'react';
import Header from './components/Header';
import DrugInput from './components/DrugInput';
import DrugListDisplay from './components/DrugListDisplay';
import CameraCapture from './components/CameraCapture';  // ← 확인!
import './index.css';

function App() {
    const [drugs, setDrugs] = useState([]);

    const addDrug = (drugName) => {
        if (drugs.includes(drugName)) {
            alert('이미 등록된 약입니다!');
            return;
        }
        if (!drugName.trim()) return;
        setDrugs([...drugs, drugName]);
    };

    const deleteDrug = (index) => {
        setDrugs(drugs.filter((_, i) => i !== index));
    };

    return (
        <div className="app-container">
            <Header />
            
            <div className="two-column-layout">
                <div className="left-column">
                    <h2 className="sub-title">1. 약 등록</h2>
                    
                    {/* 카메라 컴포넌트 - 여기! */}
                    <CameraCapture onPillDetected={addDrug} />
                    
                    {/* 텍스트 입력 */}
                    <DrugInput onAdd={addDrug} />
                    
                    {/* 약 목록 */}
                    <DrugListDisplay drugs={drugs} onDelete={deleteDrug} />
                </div>

                <div className="right-column">
                    <h2 className="sub-title">2. AI 분석 리포트</h2>
                    {drugs.length === 0 ? (
                        <p style={{ fontSize: '20px', color: '#718096' }}>
                            약을 등록하면 분석이 시작됩니다.
                        </p>
                    ) : (
                        <div>
                            <p style={{ fontSize: '24px', fontWeight: 'bold' }}>
                                등록된 약: {drugs.length}개
                            </p>
                            <ul style={{ fontSize: '20px', lineHeight: '1.8' }}>
                                {drugs.map((drug, i) => (
                                    <li key={i}>{drug}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;