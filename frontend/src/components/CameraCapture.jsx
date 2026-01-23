import React, { useState } from 'react';
import axios from 'axios';
import { pickBestOcrCandidate } from '../utils/ocrProcessor';

function CameraCapture({ onPillDetected }) {
    const [isLoading, setIsLoading] = useState(false);

    const handleCapture = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        setIsLoading(true);
        
        const formData = new FormData();
        formData.append('file', file, 'pill.jpg');
        
        try {
            const response = await axios.post('http://localhost:8000/analyze', formData);
            const ocrText = response.data.pill_name;
            const pillName = pickBestOcrCandidate(ocrText);

            if (pillName && pillName.trim()) {
                onPillDetected(pillName.trim());
                alert(`약 인식 완료: ${pillName}`);
            } else {
                alert("약 이름을 인식하지 못했습니다.");
            }
        } catch (error) {
            console.error("OCR 실패:", error);
            alert("약 인식에 실패했습니다. 백엔드 서버가 실행 중인지 확인하세요.");
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <div style={{ marginBottom: '20px' }}>
            <label style={{
                display: 'block',
                padding: '15px',
                backgroundColor: '#4299E1',
                color: 'white',
                textAlign: 'center',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '18px',
                fontWeight: 'bold'
            }}>
                사진으로 약 등록하기
                <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    onChange={handleCapture}
                    disabled={isLoading}
                    style={{ display: 'none' }}
                />
            </label>
            {isLoading && (
                <p style={{ 
                    textAlign: 'center', 
                    fontSize: '18px', 
                    color: '#4299E1',
                    marginTop: '10px' 
                }}>
                    분석 중...
                </p>
            )}
        </div>
    );
}

export default CameraCapture;