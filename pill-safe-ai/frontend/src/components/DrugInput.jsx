import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { blobToWav } from '../utils/audioWav';

function DrugInput({ onAdd }) {
    const [inputValue, setInputValue] = useState('');
    const [sttStatus, setSttStatus] = useState(null);
    const [sttError, setSttError] = useState(null);
    const [isServerSttLoading, setIsServerSttLoading] = useState(false);

    const { supported, isListening, lastTranscript, error, start, stop } = useSpeechRecognition({ lang: 'ko-KR' });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await axios.get('http://localhost:8000/stt/status');
                if (!cancelled) setSttStatus(res?.data ?? null);
            } catch {
                if (!cancelled) setSttStatus(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (lastTranscript) {
            setInputValue(lastTranscript);
        }
    }, [lastTranscript]);

    useEffect(() => {
        if (error) setSttError(error);
    }, [error]);

    const handleSubmit = () => {
        if (inputValue.trim()) {
            onAdd(inputValue);
            setInputValue(''); // 입력창 비우기
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleSubmit();
        }
    };

    const recordAndServerStt = async () => {
        setSttError(null);
        setIsServerSttLoading(true);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            const chunks = [];

            recorder.ondataavailable = (e) => {
                if (e?.data && e.data.size > 0) chunks.push(e.data);
            };

            const stopped = new Promise((resolve) => {
                recorder.onstop = () => resolve();
            });

            recorder.start();
            // 3초만 녹음(보조 기능)
            setTimeout(() => {
                try {
                    recorder.stop();
                } catch {
                    // ignore
                }
            }, 3000);

            await stopped;
            stream.getTracks().forEach((t) => t.stop());

            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

            // webm/ogg 등을 WAV로 변환
            const wav = await blobToWav(blob);

            const form = new FormData();
            form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');

            const res = await axios.post('http://localhost:8000/stt', form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            const text = (res?.data?.text ?? '').toString().trim();
            if (text) setInputValue(text);
            else setSttError('인식 결과가 비어있습니다. 조금 더 또렷하게 말씀해 주세요.');
        } catch (e) {
            const status = e?.response?.status;
            let detail = null;
            try {
                if (e?.response?.data instanceof Blob) detail = await e.response.data.text();
                else if (typeof e?.response?.data === 'string') detail = e.response.data;
            } catch {
                // ignore
            }

            setSttError(`음성 인식(STT)에 실패했습니다${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`);
        } finally {
            setIsServerSttLoading(false);
        }
    };

    const canUseServerStt = Boolean(sttStatus?.azure?.configured);

    return (
        <div>
            <div className="input-row">
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="약 이름을 입력하세요"
                    onKeyDown={handleKeyPress}
                />

                {supported ? (
                    <button
                        className={isListening ? 'btn btn-secondary' : 'btn btn-secondary'}
                        type="button"
                        onClick={() => (isListening ? stop() : start())}
                        title="브라우저 음성 인식(지원되는 브라우저에서만)"
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {isListening ? '듣는 중…' : '말로 입력'}
                    </button>
                ) : (
                    <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={recordAndServerStt}
                        disabled={!canUseServerStt || isServerSttLoading}
                        title={canUseServerStt ? 'Azure STT로 음성 인식' : 'Azure STT 미설정'}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {isServerSttLoading ? '인식 중…' : '말로 입력'}
                    </button>
                )}
            </div>

            <div className="row-actions" style={{ marginTop: 8 }}>
                <button className="btn" type="button" onClick={handleSubmit}>추가하기</button>
            </div>

            {sttError ? (
                <div className="muted" style={{ marginTop: 8, color: '#C05621' }}>{String(sttError)}</div>
            ) : null}
        </div>
    );
}

export default DrugInput; // ← 이 줄 추가!