import React, { useMemo, useState } from 'react';
import Header from './components/Header';
import DrugInput from './components/DrugInput';
import DrugListDisplay from './components/DrugListDisplay';
import CameraCapture from './components/CameraCapture';  // ← 확인!
import AnalysisReport from './components/AnalysisReport';
import VoiceGuidePlayer from './components/VoiceGuidePlayer';
import PatientInfo from './components/PatientInfo';
import { matchDrugName } from './utils/drugMatcher';
import { computeInteractions } from './utils/interactionChecker';
import './index.css';

function App() {
    const [drugs, setDrugs] = useState([]);
    const [ageYearsInput, setAgeYearsInput] = useState('');

    const addDrug = (drugName) => {
        const raw = (drugName ?? '').toString().trim();
        if (!raw) return;

        const match = matchDrugName(raw);
        const uniqueKey = match.best?.drug?.id ?? match.normalizedInput;

        if (drugs.some((d) => d.uniqueKey === uniqueKey)) {
            alert('이미 등록된 약입니다!');
            return;
        }

        const item = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            rawName: raw,
            uniqueKey,
            match
        };

        setDrugs((prev) => [...prev, item]);
    };

    const deleteDrug = (id) => {
        setDrugs((prev) => prev.filter((d) => d.id !== id));
    };

    const ageYears = useMemo(() => {
        const raw = String(ageYearsInput ?? '').trim();
        if (!raw) return null;
        const n = Number(raw);
        if (!Number.isFinite(n)) return null;
        const clamped = Math.max(0, Math.min(120, Math.floor(n)));
        return clamped;
    }, [ageYearsInput]);

    const interactionResult = useMemo(() => computeInteractions(drugs, { ageYears }), [drugs, ageYears]);

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
                    <PatientInfo ageYearsInput={ageYearsInput} onAgeYearsInputChange={setAgeYearsInput} />
                    <div style={{ height: 12 }} />
                    <AnalysisReport drugItems={drugs} interactionResult={interactionResult} />
                    <div style={{ height: 12 }} />
                    <VoiceGuidePlayer drugItems={drugs} interactionResult={interactionResult} />
                </div>
            </div>
        </div>
    );
}

export default App;