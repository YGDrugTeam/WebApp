import React, { useState } from 'react';
import { analyzePill } from '../api/pillApi';

const CameraCapture = ({ onPillDetected }) => {
    const [loading, setLoading] = useState(false);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setLoading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const data = await analyzePill(formData);
            if (!data) return;
            // data: { pill_name, ocr_text? }
            if (typeof onPillDetected === 'function') onPillDetected(data);
        } catch (error) {
            console.error("분석 실패", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ border: '2px dashed #ccc', padding: '20px' }}>
            <label style={{ cursor: 'pointer' }}>
                {loading ? "🔄 사진 분석 중..." : "📷 사진으로 약 등록하기"}
                <input type="file" accept="image/*" onChange={handleFileChange} hidden disabled={loading} />
            </label>
        </div>
    );
};

export default CameraCapture;