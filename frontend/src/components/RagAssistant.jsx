import React, { useMemo, useState } from 'react';
import { ragIndex, ragPrompt, ragQuery } from '../api/pillApi';

function RagAssistant({ ageGroup = '', ageYears = '', profileTags = [] }) {
    const [query, setQuery] = useState('');
    const [drugNamesText, setDrugNamesText] = useState('');
    const [useTools, setUseTools] = useState(true);
    const [mfdsScanPages, setMfdsScanPages] = useState(2);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [answer, setAnswer] = useState('');
    const [contexts, setContexts] = useState([]); // backward compatibility
    const [evidence, setEvidence] = useState([]);
    const [keyPoints, setKeyPoints] = useState([]);
    const [questionsNeeded, setQuestionsNeeded] = useState([]);
    const [safetyLevel, setSafetyLevel] = useState('unknown');
    const [notInContext, setNotInContext] = useState([]);
    const [showSources, setShowSources] = useState(true);
    const [showPrompt, setShowPrompt] = useState(false);
    const [promptBundle, setPromptBundle] = useState(null);

    const canAsk = useMemo(() => String(query ?? '').trim().length >= 2, [query]);

    const parsedDrugNames = useMemo(() => {
        const raw = String(drugNamesText ?? '');
        return raw
            .split(/[\n,]+/g)
            .map((s) => String(s).trim())
            .filter(Boolean)
            .slice(0, 6);
    }, [drugNamesText]);

    const runQuery = async () => {
        const q = String(query ?? '').trim();
        if (q.length < 2) return;
        setIsLoading(true);
        setError('');
        try {
            const res = await ragQuery(q, {
                k: 5,
                drugNames: useTools ? parsedDrugNames : [],
                useTools,
                mfdsScanPages: useTools ? mfdsScanPages : undefined,
                ageGroup,
                ageYears,
                profileTags,
            });
            if (res?.ok === false) {
                setAnswer('');
                setContexts([]);
                setEvidence([]);
                setKeyPoints([]);
                setQuestionsNeeded([]);
                setSafetyLevel('unknown');
                setNotInContext([]);
                setError(res?.detail || res?.error || 'RAG 질의 실패');
                return;
            }
            setAnswer(String(res?.answer ?? ''));
            setSafetyLevel(typeof res?.safety_level === 'string' ? res.safety_level : 'unknown');
            setKeyPoints(Array.isArray(res?.key_points) ? res.key_points : []);
            setQuestionsNeeded(Array.isArray(res?.questions_needed) ? res.questions_needed : []);
            setEvidence(Array.isArray(res?.evidence) ? res.evidence : []);
            setContexts(Array.isArray(res?.contexts) ? res.contexts : []);
            setNotInContext(Array.isArray(res?.not_in_context) ? res.not_in_context : []);
        } catch (e) {
            const status = e?.response?.status;
            const data = e?.response?.data;
            const isNetworkError = String(e?.message ?? '').toLowerCase().includes('network error');
            const detail =
                (typeof data?.detail === 'string' && data.detail) ||
                (typeof data?.error === 'string' && data.error) ||
                (typeof e?.message === 'string' && e.message) ||
                '';
            setAnswer('');
            setContexts([]);
            setEvidence([]);
            setKeyPoints([]);
            setQuestionsNeeded([]);
            setSafetyLevel('unknown');
            setNotInContext([]);
            if (!status && isNetworkError) {
                setError('RAG 질의 실패: 백엔드 연결 불가(네트워크 오류). 백엔드가 실행 중인지 확인해 주세요.');
            } else {
                setError(status ? `RAG 질의 실패 (HTTP ${status})${detail ? `: ${detail}` : ''}` : `RAG 질의 실패${detail ? `: ${detail}` : ''}`);
            }
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

    const loadPrompt = async () => {
        setIsLoading(true);
        setError('');
        try {
            const res = await ragPrompt();
            if (res?.ok === false) {
                setError(res?.detail || res?.error || '프롬프트 조회 실패');
                return;
            }
            setPromptBundle(res);
            setShowPrompt(true);
        } catch (e) {
            const status = e?.response?.status;
            const data = e?.response?.data;
            const detail =
                (typeof data?.detail === 'string' && data.detail) ||
                (typeof data?.error === 'string' && data.error) ||
                (typeof e?.message === 'string' && e.message) ||
                '';
            setError(status ? `프롬프트 조회 실패 (HTTP ${status})${detail ? `: ${detail}` : ''}` : `프롬프트 조회 실패${detail ? `: ${detail}` : ''}`);
        } finally {
            setIsLoading(false);
        }
    };

    const badge = (() => {
        const v = String(safetyLevel || 'unknown');
        const map = {
            ok: { label: '안전', bg: '#E6FFFA', fg: '#234E52', border: '#B2F5EA' },
            caution: { label: '주의', bg: '#FEFCBF', fg: '#744210', border: '#F6E05E' },
            avoid: { label: '피함', bg: '#FED7D7', fg: '#742A2A', border: '#FEB2B2' },
            unknown: { label: '미확인', bg: '#EDF2F7', fg: '#2D3748', border: '#E2E8F0' },
        };
        const c = map[v] || map.unknown;
        return (
            <span style={{ fontSize: 11, fontWeight: 900, padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}>
                {c.label}
            </span>
        );
    })();

    return (
        <div style={{ marginTop: 14, padding: 12, border: '1px solid #E2E8F0', borderRadius: 12, background: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontWeight: 900 }}>RAG 어시스턴트</div>
                <div style={{ fontSize: 12, color: '#718096' }}>로컬 지식베이스 기반</div>
                {badge}
                <button type="button" onClick={rebuildIndex} disabled={isLoading} style={{ marginLeft: 'auto' }}>
                    인덱스 재생성
                </button>
                <button
                    type="button"
                    onClick={() => (promptBundle ? setShowPrompt((v) => !v) : loadPrompt())}
                    disabled={isLoading}
                    style={{ marginLeft: 6 }}
                >
                    {showPrompt ? '프롬프트 닫기' : '프롬프트 보기'}
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

            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#FAFAFA', border: '1px solid #EDF2F7' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#2D3748' }}>
                        <input type="checkbox" checked={useTools} onChange={(e) => setUseTools(e.target.checked)} />
                        공식 근거(MFDS/DUR) 사용
                    </label>

                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#2D3748' }}>
                        MFDS 스캔 페이지
                        <input
                            type="number"
                            min={0}
                            max={20}
                            step={1}
                            value={Number.isFinite(mfdsScanPages) ? mfdsScanPages : 2}
                            onChange={(e) => {
                                const v = Number(e.target.value);
                                setMfdsScanPages(Number.isFinite(v) ? v : 2);
                            }}
                            disabled={!useTools}
                            style={{ width: 80 }}
                        />
                    </label>
                </div>

                <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: 12, color: '#4A5568', marginBottom: 6 }}>약 이름(선택)</div>
                    <textarea
                        value={drugNamesText}
                        onChange={(e) => setDrugNamesText(e.target.value)}
                        placeholder="예: 타이레놀\n이부프로펜 (2개 이상이면 DUR 상호작용 근거가 붙습니다)"
                        rows={2}
                        disabled={!useTools}
                        style={{ width: '100%', resize: 'vertical' }}
                    />
                    {useTools && parsedDrugNames.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#718096' }}>전달될 약: {parsedDrugNames.join(', ')}</div>
                    )}
                </div>
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

            {Array.isArray(keyPoints) && keyPoints.length > 0 && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#FAFAFA', border: '1px solid #EDF2F7' }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>핵심 요약</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                        {keyPoints.slice(0, 5).map((p, idx) => (
                            <div key={idx} style={{ fontSize: 13, color: '#2D3748' }}>
                                - {String(p)}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {Array.isArray(questionsNeeded) && questionsNeeded.length > 0 && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#FFF5F7', border: '1px solid #FED7E2' }}>
                    <div style={{ fontWeight: 800, marginBottom: 6, color: '#97266D' }}>추가로 확인할 질문</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                        {questionsNeeded.slice(0, 3).map((p, idx) => (
                            <div key={idx} style={{ fontSize: 13, color: '#702459' }}>
                                - {String(p)}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {Array.isArray(notInContext) && notInContext.length > 0 && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#F7FAFC', border: '1px solid #E2E8F0' }}>
                    <div style={{ fontWeight: 800, marginBottom: 6, color: '#2D3748' }}>진단/메모</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                        {notInContext.slice(0, 5).map((p, idx) => (
                            <div key={idx} style={{ fontSize: 12, color: '#4A5568', whiteSpace: 'pre-wrap' }}>
                                - {String(p)}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {showPrompt && promptBundle?.templates?.strict && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#F0FFF4', border: '1px solid #C6F6D5' }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>LLM 프롬프트 템플릿(Strict)</div>
                    <div style={{ fontSize: 12, color: '#22543D', marginBottom: 6 }}>외부 LLM을 붙일 때 복사해서 사용하세요.</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 12, color: '#22543D' }}>SYSTEM</div>
                            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#FFFFFF', border: '1px solid #E2E8F0', padding: 8, borderRadius: 8 }}>
                                {String(promptBundle.templates.strict.system || '')}
                            </pre>
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 12, color: '#22543D' }}>DEVELOPER</div>
                            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#FFFFFF', border: '1px solid #E2E8F0', padding: 8, borderRadius: 8 }}>
                                {String(promptBundle.templates.strict.developer || '')}
                            </pre>
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 12, color: '#22543D' }}>USER 템플릿</div>
                            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#FFFFFF', border: '1px solid #E2E8F0', padding: 8, borderRadius: 8 }}>
                                {String(promptBundle.templates.strict.user || '')}
                            </pre>
                        </div>
                    </div>
                </div>
            )}

            {(Array.isArray(evidence) ? evidence.length : 0) > 0 && (
                <div style={{ marginTop: 10 }}>
                    <button
                        type="button"
                        onClick={() => setShowSources((v) => !v)}
                        style={{ fontSize: 12, color: '#2D3748', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                        {showSources ? '근거 접기' : '근거 펼치기'} ({evidence.length})
                    </button>

                    {showSources && (
                        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                            {evidence.slice(0, 6).map((ev, idx) => (
                                <div key={idx} style={{ padding: 10, borderRadius: 10, border: '1px solid #EDF2F7', background: '#FAFAFA' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                        <div style={{ fontWeight: 800 }}>{String(ev?.field ?? ev?.source ?? '근거')}</div>
                                        <div style={{ fontSize: 12, color: '#718096' }}>{String(ev?.id ?? '')}</div>
                                    </div>
                                    {ev?.snippet && (
                                        <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontSize: 13, color: '#2D3748' }}>{String(ev.snippet)}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {evidence.length === 0 && contexts.length > 0 && (
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
                                        <div style={{ fontSize: 12, color: '#718096' }}>점수: {String(c?.score ?? '')}</div>
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
