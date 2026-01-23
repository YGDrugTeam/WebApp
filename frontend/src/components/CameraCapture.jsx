import React, { useState } from 'react';
import { analyzePill } from '../api/pillApi';

const CameraCapture = ({ onPillDetected }) => {
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState('auto');
    const [debug, setDebug] = useState(false);

    const handleFileChange = async (e) => {
        const inputEl = e?.target;
        const file = inputEl?.files?.[0];
        if (!file) return;

        setLoading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const data = await analyzePill(formData, { mode, debug });
            if (!data) return;
            // data: { pill_name, ocr_text? }
            if (typeof onPillDetected === 'function') onPillDetected(data);
        } catch (error) {
            console.error("분석 실패", error);
        } finally {
            setLoading(false);
            // Allow selecting the same file again to re-run OCR.
            try {
                if (inputEl) inputEl.value = '';
            } catch {
                // ignore
            }
        }
    };

    return (
        <div style={{ border: '2px dashed #ccc', padding: '20px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 700 }}>인식 모드</span>
                <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={loading}>
                    <option value="auto">자동(상자+각인)</option>
                    <option value="box">상자/라벨 텍스트</option>
                    <option value="pill">알약 각인(영문/숫자)</option>
                </select>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                    <input
                        type="checkbox"
                        checked={debug}
                        onChange={(e) => setDebug(e.target.checked)}
                        disabled={loading}
                    />
                    <span style={{ fontSize: 12, color: '#4A5568' }}>디버그</span>
                </label>
                <span style={{ fontSize: 12, color: '#666' }}>
                    {mode === 'pill'
                        ? '각인이 화면에 크게 보이게 가까이 촬영'
                        : mode === 'box'
                            ? '라벨이 정면으로 오게, 반사 줄이기'
                            : '상자/각인 둘 다 시도'}
                </span>
            </div>

            <label style={{ cursor: 'pointer' }}>
                {loading ? "🔄 사진 분석 중..." : "📷 사진으로 약 등록하기"}
                <input type="file" accept="image/*" onChange={handleFileChange} hidden disabled={loading} />
            </label>
        </div>
    );
};

export default CameraCapture;