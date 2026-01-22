import React, { useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import CameraCapture from './components/CameraCapture';
import DrugInput from './components/DrugInput';
import DrugListDisplay from './components/DrugListDisplay';
import DangerCard from './components/DangerCard';
import AnalysisReport from './components/AnalysisReport';
import VoiceGuidePlayer from './components/VoiceGuidePlayer';
import { checkDur, checkSafety } from './api/pillApi';
import useSpeechSynthesis from './hooks/useSpeechSynthesis';
import { extractDrugCandidates } from './utils/ocrProcessor';
import { matchDrug } from './utils/drugMatcher';
import { checkInteractions } from './utils/interactionChecker';
import './App.css';
import './styles/index.css';

function App() {
    const [pillList, setPillList] = useState([]); // canonical names (strings)
    const [pillMeta, setPillMeta] = useState({}); // { [canonicalName]: { itemSeq?, entpName?, source? } }
    const [aiReport, setAiReport] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [cameraRecommendations, setCameraRecommendations] = useState([]);
    const [voiceGender, setVoiceGender] = useState('female');
    const [ageGroup, setAgeGroup] = useState('');
    const [pendingRecommendation, setPendingRecommendation] = useState(null);
    const [pendingRecommendationText, setPendingRecommendationText] = useState('');
    const [durInteractions, setDurInteractions] = useState({ warnings: [], cautions: [], info: [] });
    const { speak } = useSpeechSynthesis({ lang: 'ko-KR' }); // 음성 기능 가져오기

    const speakWithPreference = (text) => speak(text, { gender: voiceGender });

    // 약 추가 및 음성 안내
    const handleAddPill = (rawName, meta) => {
        const name = String(rawName ?? '').trim();
        if (!name) return;
        const matched = matchDrug(name);
        const canonical = matched?.canonicalName ?? name;

        if (meta && typeof meta === 'object') {
            const itemSeq = meta?.itemSeq ? String(meta.itemSeq).trim() : '';
            const entpName = meta?.entpName ? String(meta.entpName).trim() : '';
            const source = meta?.source ? String(meta.source).trim() : '';
            setPillMeta((prev) => ({
                ...prev,
                [canonical]: {
                    ...(prev?.[canonical] ?? {}),
                    itemSeq: itemSeq || (prev?.[canonical]?.itemSeq ?? null),
                    entpName: entpName || (prev?.[canonical]?.entpName ?? null),
                    source: source || (prev?.[canonical]?.source ?? null),
                },
            }));
        }

        setPillList((prev) => {
            if (prev.includes(canonical)) return prev;
            const updated = [...prev, canonical];
            speakWithPreference(`${canonical}이 리스트에 추가되었습니다.`);
            return updated;
        });
    };

    const handleDetectedFromCamera = (payload) => {
        const top = Array.isArray(payload?.top_matches) ? payload.top_matches : [];
        if (top.length > 0) {
            const sorted = [...top].sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0));
            const matchedOnly = sorted.filter((x) => Boolean(x?.matched));
            const picks = (matchedOnly.length > 0 ? matchedOnly : sorted).slice(0, 3);
            setCameraRecommendations(picks);
            speakWithPreference('사진 분석이 완료되었습니다. 추천 목록에서 선택해 주세요.');
            return;
        }

        const pillName = payload?.pill_name ?? '';
        const ocrText = payload?.ocr_text ?? '';
        const candidates = extractDrugCandidates([pillName, ocrText].filter(Boolean).join(' '));
        const first = candidates[0] ?? pillName;
        if (first) handleAddPill(first);
    };

    const openRecommendation = (rec) => {
        if (!rec) return;
        if (rec.matched) {
            handleAddPill(rec.name);
            setCameraRecommendations([]);
            return;
        }
        setPendingRecommendation(rec);
        setPendingRecommendationText(String(rec?.name ?? ''));
    };

    const pendingPreview = useMemo(() => {
        const name = String(pendingRecommendationText ?? '').trim();
        if (!name) return null;
        try {
            return matchDrug(name);
        } catch {
            return null;
        }
    }, [pendingRecommendationText]);

    const localInteractions = useMemo(
        () => checkInteractions(pillList, ageGroup ? { ageGroup } : undefined),
        [pillList, ageGroup]
    );

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if ((pillList?.length ?? 0) < 2) {
                if (!cancelled) setDurInteractions({ warnings: [], cautions: [], info: [] });
                return;
            }

            try {
                const drugs = (pillList ?? []).map((name) => ({
                    name,
                    itemSeq: pillMeta?.[name]?.itemSeq ?? null,
                    entpName: pillMeta?.[name]?.entpName ?? null,
                }));
                const res = await checkDur(drugs, {
                    scanLimit: 3000,
                    perPage: 100,
                    maxPages: 80,
                    ingredientsByDrug: localInteractions?.ingredientsByDrug ?? {},
                });
                if (cancelled) return;
                if (res?.ok === false) {
                    setDurInteractions({ warnings: [], cautions: [], info: [] });
                    return;
                }
                setDurInteractions({
                    warnings: res?.warnings ?? [],
                    cautions: res?.cautions ?? [],
                    info: res?.info ?? [],
                });
            } catch {
                if (!cancelled) setDurInteractions({ warnings: [], cautions: [], info: [] });
            }
        };
        run();
        return () => {
            cancelled = true;
        };
    }, [pillList, pillMeta, localInteractions]);

    const interactions = useMemo(() => {
        const warnings = [...(localInteractions?.warnings ?? []), ...(durInteractions?.warnings ?? [])];
        const cautions = [...(localInteractions?.cautions ?? []), ...(durInteractions?.cautions ?? [])];
        const info = [...(localInteractions?.info ?? []), ...(durInteractions?.info ?? [])];
        return {
            ...localInteractions,
            warnings,
            cautions,
            info,
            dur: durInteractions,
        };
    }, [localInteractions, durInteractions]);

    const handleAnalyze = async () => {
        setIsAnalyzing(true);
        try {
            const data = await checkSafety(pillList);
            setAiReport(data.result ?? '');
            speakWithPreference('분석이 완료되었습니다. 리포트를 확인해 주세요.');
        } catch (error) {
            speakWithPreference('분석 중 오류가 발생했습니다.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="app-shell">
            <Header />

            {pendingRecommendation && (
                <div
                    className="modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="recommendation confirmation"
                    onMouseDown={(e) => {
                        // click outside to close
                        if (e.target === e.currentTarget) {
                            setPendingRecommendation(null);
                            setPendingRecommendationText('');
                        }
                    }}
                >
                    <div className="modal">
                        <h3>추정 후보 확인</h3>
                        <p className="meta" style={{ marginTop: 0 }}>
                            확신도 높은 매칭이 없어 ‘추정’ 후보입니다. 맞는 약이면 추가를 눌러 주세요.
                        </p>
                        <div style={{ marginTop: 10, padding: 12, border: '1px solid #EDF2F7', borderRadius: 12, background: '#FAFAFA' }}>
                            <div style={{ fontWeight: 900 }}>{pendingRecommendation.name}</div>
                            <div className="meta">점수: {pendingRecommendation.score} / OCR 후보: {pendingRecommendation.source || '없음'}</div>
                        </div>

						<div style={{ marginTop: 12 }}>
							<label className="meta" htmlFor="recommendation-edit" style={{ display: 'block', marginBottom: 6 }}>
								추정 후보 이름 수정(선택)
							</label>
							<input
								id="recommendation-edit"
								type="text"
								value={pendingRecommendationText}
								onChange={(e) => setPendingRecommendationText(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										const fixed = String(pendingRecommendationText ?? '').trim();
										if (fixed) {
											handleAddPill(fixed);
											setPendingRecommendation(null);
											setPendingRecommendationText('');
											setCameraRecommendations([]);
										}
									}
								}}
								placeholder="예: 타이레놀 500mg"
								style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid #E2E8F0' }}
							/>
							{pendingPreview && (
								<div className="meta" style={{ marginTop: 8 }}>
									자동 매칭 미리보기: {pendingPreview.canonicalName}{' '}
									{pendingPreview.matched ? (
										<span style={{ color: '#2F855A', fontWeight: 800 }}>(매칭)</span>
									) : (
										<span style={{ color: '#DD6B20', fontWeight: 800 }}>(미매칭)</span>
									)}
									<span style={{ marginLeft: 6 }}>점수: {pendingPreview.score ?? 0}</span>
								</div>
							)}
						</div>

                        <div className="btn-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                            <button
								type="button"
								onClick={() => {
									setPendingRecommendation(null);
									setPendingRecommendationText('');
								}}
							>
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const fixed = String(pendingRecommendationText ?? pendingRecommendation.name ?? '').trim();
                                    if (!fixed) return;
                                    handleAddPill(fixed);
                                    setPendingRecommendation(null);
                                    setPendingRecommendationText('');
                                    setCameraRecommendations([]);
                                }}
                            >
                                추가
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="app-layout">
                <div>
                    <div className="card">
                        <h3>목소리 설정</h3>
                        <div className="btn-row" style={{ alignItems: 'center' }}>
                            <span style={{ color: '#4A5568' }}>기본 안내 목소리</span>
                            <div className="segmented" role="group" aria-label="voice gender">
                                <button
                                    className={voiceGender === 'female' ? 'active' : ''}
                                    onClick={() => setVoiceGender('female')}
                                    type="button"
                                >
                                    여성
                                </button>
                                <button
                                    className={voiceGender === 'male' ? 'active' : ''}
                                    onClick={() => setVoiceGender('male')}
                                    type="button"
                                >
                                    남성
                                </button>
                            </div>
                        </div>

                        <div className="btn-row" style={{ alignItems: 'center', marginTop: 10 }}>
                            <span style={{ color: '#4A5568' }}>사용자 프로필(선택)</span>
                            <select
                                value={ageGroup}
                                onChange={(e) => setAgeGroup(e.target.value)}
                                style={{
                                    marginLeft: 'auto',
                                    padding: '8px 10px',
                                    borderRadius: 10,
                                    border: '1px solid #E2E8F0',
                                    background: 'white',
                                }}
                                aria-label="age profile"
                            >
                                <option value="">선택 안 함</option>
                                <option value="student">수험생</option>
                                <option value="senior">어르신</option>
                            </select>
                        </div>
                    </div>

                    <CameraCapture onPillDetected={handleDetectedFromCamera} />

                    {cameraRecommendations.length > 0 && (
                        <section className="card">
                            <h3>사진 분석 추천 (Top 3)</h3>
                            {cameraRecommendations.some((r) => Boolean(r?.matched)) ? (
                                <p style={{ marginTop: 0, color: '#4A5568' }}>
                                    DB에 매칭된 후보만 우선 보여드려요. 하나를 선택해 리스트에 추가하세요.
                                </p>
                            ) : (
                                <p style={{ marginTop: 0, color: '#DD6B20', fontWeight: 700 }}>
                                    확신도 높은 매칭이 없어 ‘추정’ 후보를 보여드려요. OCR 후보를 확인한 뒤 선택하세요.
                                </p>
                            )}
                            <div className="recommendation-grid">
                                {cameraRecommendations.map((rec) => (
                                    <div className="recommendation-item" key={`${rec.name}-${rec.score}`}
                                         title={rec.source ? `OCR 후보: ${rec.source}` : ''}
                                    >
                                        <button
                                            style={{ width: '100%' }}
                                            onClick={() => {
                                                openRecommendation(rec);
                                            }}
                                            type="button"
                                        >
                                            {rec.name}
                                            {' '}
                                            <span style={{ color: '#4A5568' }}>({rec.score})</span>
                                            {rec.matched ? (
                                                <span style={{ marginLeft: 8, color: '#2F855A', fontWeight: 800 }}>
                                                    매칭됨
                                                </span>
                                            ) : (
                                                <span style={{ marginLeft: 8, color: '#DD6B20', fontWeight: 800 }}>
                                                    추정
                                                </span>
                                            )}
                                        </button>
                                        {rec.source && <small>OCR 후보: {String(rec.source).slice(0, 30)}{String(rec.source).length > 30 ? '…' : ''}</small>}
                                    </div>
                                ))}
                            </div>
                            <div className="btn-row" style={{ marginTop: 10 }}>
                                <button onClick={() => setCameraRecommendations([])} type="button">닫기</button>
                            </div>
                        </section>
                    )}

                    <div className="card">
                        <h3>약 추가</h3>
                        <DrugInput onAdd={handleAddPill} />
                    </div>

                    <section className="card">
                        <h3 className="sub-title">등록된 의약품 ({pillList.length})</h3>
                        <DrugListDisplay
                            drugs={pillList}
                            onDelete={(index) => setPillList(pillList.filter((_, idx) => idx !== index))}
                        />
                    </section>
                </div>

                <div>
                    <DangerCard interactions={interactions} />

                    <button
                        className="main-analyze-btn"
                        onClick={handleAnalyze}
                        disabled={pillList.length === 0 || isAnalyzing}
                        style={{ marginTop: 16 }}
                        type="button"
                    >
                        {isAnalyzing ? 'AI 분석 중…' : '종합 안전성 분석 시작'}
                    </button>

                    <AnalysisReport aiReport={aiReport} interactions={interactions} />
                    <VoiceGuidePlayer
                        pillList={pillList}
                        interactions={interactions}
                        aiReport={aiReport}
                        voiceGender={voiceGender}
                        onVoiceGenderChange={setVoiceGender}
                    />
                </div>
            </div>
        </div>
    );
}

export default App;