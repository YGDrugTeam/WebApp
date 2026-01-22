import React, { useMemo, useState } from 'react';
import { ragIndex, ragQuery } from '../api/pillApi';

function RagAssistant() {
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [answer, setAnswer] = useState('');
    const [contexts, setContexts] = useState([]);
    const [showSources, setShowSources] = useState(true);

    const canAsk = useMemo(() => String(query ?? '').trim().length >= 2, [query]);

    const runQuery = async () => {
        const q = String(query ?? '').trim();
        if (q.length < 2) return;
        setIsLoading(true);
        setError('');
        try {
            const res = await ragQuery(q, { k: 5 });
            if (res?.ok === false) {
                setAnswer('');
                setContexts([]);
                setError(res?.detail || res?.error || 'RAG 질의 실패');
                return;
            }
            setAnswer(String(res?.answer ?? ''));
            setContexts(Array.isArray(res?.contexts) ? res.contexts : []);
        } catch (e) {
            const status = e?.response?.status;
            const data = e?.response?.data;
            const detail =
                (typeof data?.detail === 'string' && data.detail) ||
                (typeof data?.error === 'string' && data.error) ||
                (typeof e?.message === 'string' && e.message) ||
                '';
            setAnswer('');
            setContexts([]);
            setError(status ? `RAG 질의 실패 (HTTP ${status})${detail ? `: ${detail}` : ''}` : `RAG 질의 실패${detail ? `: ${detail}` : ''}`);
        } finally {
            setIsLoading(false);
        }
    };

    const rebuildIndex = async () => {
        setIsLoading(true);
        setError('');
        try {
            const res = await ragIndex({ save: true });
            if (res?.ok === false) {
                setError(res?.detail || res?.error || '인덱스 생성 실패');
                return;
            }
            setError('');
        } catch (e) {
            const status = e?.response?.status;
            const data = e?.response?.data;
            const detail =
                (typeof data?.detail === 'string' && data.detail) ||
                (typeof data?.error === 'string' && data.error) ||
                (typeof e?.message === 'string' && e.message) ||
                '';
            setError(status ? `인덱스 생성 실패 (HTTP ${status})${detail ? `: ${detail}` : ''}` : `인덱스 생성 실패${detail ? `: ${detail}` : ''}`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{ marginTop: 14, padding: 12, border: '1px solid #E2E8F0', borderRadius: 12, background: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontWeight: 900 }}>RAG 어시스턴트</div>
                <div style={{ fontSize: 12, color: '#718096' }}>로컬 지식베이스 기반</div>
                <button type="button" onClick={rebuildIndex} disabled={isLoading} style={{ marginLeft: 'auto' }}>
                    인덱스 재생성
                </button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') runQuery();
                    }}
                    placeholder="예: 타이레놀 주의사항 / NSAID 중복 복용"
                    style={{ flex: 1 }}
                />
                <button type="button" onClick={runQuery} disabled={!canAsk || isLoading}>
                    {isLoading ? '조회 중…' : '질문하기'}
                </button>
            </div>

            {error && (
                <div style={{ marginTop: 8, color: '#B83280', fontSize: 13 }}>{error}</div>
            )}

            {answer && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#F7FAFC', border: '1px solid #EDF2F7' }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>답변</div>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{answer}</div>
                </div>
            )}

            {contexts.length > 0 && (
                <div style={{ marginTop: 10 }}>
                    <button
                        type="button"
                        onClick={() => setShowSources((v) => !v)}
                        style={{ fontSize: 12, color: '#2D3748', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                        {showSources ? '근거 접기' : '근거 펼치기'} ({contexts.length})
                    </button>

                    {showSources && (
                        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                            {contexts.slice(0, 5).map((c) => (
                                <div key={String(c?.id ?? Math.random())} style={{ padding: 10, borderRadius: 10, border: '1px solid #EDF2F7', background: '#FAFAFA' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                        <div style={{ fontWeight: 800 }}>{String(c?.title ?? '')}</div>
                                        <div style={{ fontSize: 12, color: '#718096' }}>score: {String(c?.score ?? '')}</div>
                                    </div>
                                    {c?.meta?.source && (
                                        <div style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>{String(c.meta.source)}</div>
                                    )}
                                    {c?.text && (
                                        <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontSize: 13, color: '#2D3748' }}>{String(c.text)}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default RagAssistant;
