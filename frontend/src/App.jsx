import React, { useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import CameraCapture from './components/CameraCapture';
import DrugInput from './components/DrugInput';
import DrugListDisplay from './components/DrugListDisplay';
import DangerCard from './components/DangerCard';
import AnalysisReport from './components/AnalysisReport';
import VoiceGuidePlayer from './components/VoiceGuidePlayer';
import RagAssistant from './components/RagAssistant';
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
    const [cameraOcrInfo, setCameraOcrInfo] = useState({ merged: '', box: '', pill: '', debug: [] });
    const [voiceGender, setVoiceGender] = useState('female');
    const [ageYears, setAgeYears] = useState('');
    const [extraProfileTags, setExtraProfileTags] = useState([]); // e.g. ['student']
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
        const mergedText = String(payload?.ocr_text ?? '');
        const boxText = String(payload?.ocr_text_box ?? '');
        const pillText = String(payload?.ocr_text_pill ?? '');
        const debugAttempts = Array.isArray(payload?.ocr_debug) ? payload.ocr_debug : [];
        setCameraOcrInfo({ merged: mergedText, box: boxText, pill: pillText, debug: debugAttempts });

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
        const ocrBox = payload?.ocr_text_box ?? '';
        const ocrPill = payload?.ocr_text_pill ?? '';
        const merged = [pillName, ocrText, ocrBox, ocrPill].filter(Boolean).join(' ');
        const candidates = extractDrugCandidates(merged);
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

    const derivedAgeGroup = useMemo(() => {
        const raw = String(ageYears ?? '').trim();
        if (!raw) return '';
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return '';
        // Simple, UI-only grouping. If you need different thresholds, change here.
        if (n <= 6) return 'infant';
        if (n <= 12) return 'child';
        if (n <= 18) return 'teen';
        if (n <= 44) return 'adult';
        if (n <= 64) return 'middle';
        return 'senior';
    }, [ageYears]);

    const derivedAgeLabel = useMemo(() => {
        const m = {
            infant: '유아',
            child: '소아',
            teen: '청소년',
            adult: '성인',
            middle: '중년',
            senior: '노년',
        };
        return derivedAgeGroup ? (m[derivedAgeGroup] || derivedAgeGroup) : '';
    }, [derivedAgeGroup]);

    const profileTags = useMemo(() => {
        const tags = Array.isArray(extraProfileTags) ? extraProfileTags : [];
        return tags.map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 4);
    }, [extraProfileTags]);

    const localInteractions = useMemo(() => {
        const opts = {};
        if (derivedAgeGroup) opts.ageGroup = derivedAgeGroup;
        if ((profileTags?.length ?? 0) > 0) opts.profileTags = profileTags;
        return checkInteractions(pillList, Object.keys(opts).length ? opts : undefined);
    }, [pillList, derivedAgeGroup, profileTags]);

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
                    aria-label="추천 후보 확인"
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
                            <div className="segmented" role="group" aria-label="목소리 성별">
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
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label className="meta" htmlFor="age-years" style={{ margin: 0 }}>
                                    나이
                                </label>
                                <input
                                    id="age-years"
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={130}
                                    value={ageYears}
                                    onChange={(e) => setAgeYears(e.target.value)}
                                    placeholder="예: 35"
                                    style={{
                                        width: 110,
                                        padding: '8px 10px',
                                        borderRadius: 10,
                                        border: '1px solid #E2E8F0',
                                        background: 'white',
                                    }}
                                    aria-label="나이(세)"
                                />
                                <div className="meta" style={{ minWidth: 64, textAlign: 'right' }}>
                                    {derivedAgeLabel ? derivedAgeLabel : '미설정'}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setAgeYears('')}
                                    className="subtle"
                                    style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #E2E8F0', background: 'white' }}
                                    aria-label="나이 지우기"
                                >
                                    지우기
                                </button>
                            </div>
                        </div>

                        <div className="btn-row" style={{ alignItems: 'center', marginTop: 10 }}>
                            <span style={{ color: '#4A5568' }}>추가 프로필(선택)</span>
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                                <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={profileTags.includes('student')}
                                        onChange={(e) => {
                                            const checked = Boolean(e.target.checked);
                                            setExtraProfileTags((prev) => {
                                                const cur = Array.isArray(prev) ? prev : [];
                                                const next = new Set(cur.map((x) => String(x)));
                                                if (checked) next.add('student');
                                                else next.delete('student');
                                                return Array.from(next);
                                            });
                                        }}
                                        aria-label="수험생 프로필 선택"
                                    />
                                    수험생
                                </label>

                                <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={profileTags.includes('pregnant')}
                                        onChange={(e) => {
                                            const checked = Boolean(e.target.checked);
                                            setExtraProfileTags((prev) => {
                                                const cur = Array.isArray(prev) ? prev : [];
                                                const next = new Set(cur.map((x) => String(x)));
                                                if (checked) next.add('pregnant');
                                                else next.delete('pregnant');
                                                return Array.from(next);
                                            });
                                        }}
                                        aria-label="임신 프로필 선택"
                                    />
                                    임신
                                </label>

                                <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={profileTags.includes('lactation')}
                                        onChange={(e) => {
                                            const checked = Boolean(e.target.checked);
                                            setExtraProfileTags((prev) => {
                                                const cur = Array.isArray(prev) ? prev : [];
                                                const next = new Set(cur.map((x) => String(x)));
                                                if (checked) next.add('lactation');
                                                else next.delete('lactation');
                                                return Array.from(next);
                                            });
                                        }}
                                        aria-label="수유 프로필 선택"
                                    />
                                    수유
                                </label>

                                <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={profileTags.includes('liver')}
                                        onChange={(e) => {
                                            const checked = Boolean(e.target.checked);
                                            setExtraProfileTags((prev) => {
                                                const cur = Array.isArray(prev) ? prev : [];
                                                const next = new Set(cur.map((x) => String(x)));
                                                if (checked) next.add('liver');
                                                else next.delete('liver');
                                                return Array.from(next);
                                            });
                                        }}
                                        aria-label="간질환 프로필 선택"
                                    />
                                    간질환
                                </label>

                                <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={profileTags.includes('kidney')}
                                        onChange={(e) => {
                                            const checked = Boolean(e.target.checked);
                                            setExtraProfileTags((prev) => {
                                                const cur = Array.isArray(prev) ? prev : [];
                                                const next = new Set(cur.map((x) => String(x)));
                                                if (checked) next.add('kidney');
                                                else next.delete('kidney');
                                                return Array.from(next);
                                            });
                                        }}
                                        aria-label="신장질환 프로필 선택"
                                    />
                                    신장질환
                                </label>

                                <label className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={profileTags.includes('allergy')}
                                        onChange={(e) => {
                                            const checked = Boolean(e.target.checked);
                                            setExtraProfileTags((prev) => {
                                                const cur = Array.isArray(prev) ? prev : [];
                                                const next = new Set(cur.map((x) => String(x)));
                                                if (checked) next.add('allergy');
                                                else next.delete('allergy');
                                                return Array.from(next);
                                            });
                                        }}
                                        aria-label="알레르기 프로필 선택"
                                    />
                                    알레르기
                                </label>
                            </div>
                        </div>
                    </div>

                    <CameraCapture onPillDetected={handleDetectedFromCamera} />

                    {(cameraOcrInfo.merged || cameraOcrInfo.box || cameraOcrInfo.pill || (cameraOcrInfo.debug?.length ?? 0) > 0) && (
                        <section className="card" style={{ marginTop: 12 }}>
                            <h3 style={{ marginBottom: 8 }}>OCR 디버그</h3>
                            <div style={{ display: 'grid', gap: 8 }}>
                                {cameraOcrInfo.box && (
                                    <div>
                                        <div style={{ fontWeight: 800 }}>상자/라벨</div>
                                        <div style={{ fontSize: 13, color: '#2D3748', whiteSpace: 'pre-wrap' }}>{cameraOcrInfo.box}</div>
                                    </div>
                                )}
                                {cameraOcrInfo.pill && (
                                    <div>
                                        <div style={{ fontWeight: 800 }}>알약 각인</div>
                                        <div style={{ fontSize: 13, color: '#2D3748', whiteSpace: 'pre-wrap' }}>{cameraOcrInfo.pill}</div>
                                    </div>
                                )}
                                {cameraOcrInfo.merged && (
                                    <details>
                                        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>병합 텍스트(자동 후보 생성에 사용)</summary>
                                        <div style={{ marginTop: 6, fontSize: 13, color: '#2D3748', whiteSpace: 'pre-wrap' }}>{cameraOcrInfo.merged}</div>
                                    </details>
                                )}
                                {(cameraOcrInfo.debug?.length ?? 0) > 0 && (
                                    <details>
                                        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>상위 OCR 시도</summary>
                                        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                                            {cameraOcrInfo.debug.slice(0, 8).map((a, idx) => (
                                                <div
                                                    key={`${a.region}-${a.variant}-${idx}`}
                                                    style={{ padding: 10, border: '1px solid #EDF2F7', borderRadius: 10, background: '#F7FAFC' }}
                                                >
                                                    <div style={{ fontWeight: 800 }}>
                                                        {a.region} / {a.variant}
                                                        <span style={{ marginLeft: 8, color: '#4A5568', fontWeight: 700 }}>
                                                            점수: {Number(a.score ?? 0).toFixed(2)}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: 13, color: '#2D3748', whiteSpace: 'pre-wrap' }}>
                                                        {String(a.text ?? '').trim() || '(없음)'}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}
                            </div>
                        </section>
                    )}

                    {cameraRecommendations.length > 0 && (
                        <section className="card">
                            <h3>사진 분석 추천 (상위 3)</h3>
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
                        <RagAssistant ageGroup={derivedAgeGroup} ageYears={ageYears} profileTags={profileTags} />
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