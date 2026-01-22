import React, { useMemo, useState } from 'react';
import useSpeechSynthesis from '../hooks/useSpeechSynthesis';

function normalizeString(value) {
	return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export default function VoiceGuidePlayer({ pillList, interactions, aiReport, voiceGender = 'female', onVoiceGenderChange }) {
	const { supported, speaking, speak, cancel, voices, voicesLoaded, refreshVoices } = useSpeechSynthesis({ lang: 'ko-KR' });
	const [showDiagnostics, setShowDiagnostics] = useState(false);

	const script = useMemo(() => {
		const pills = (pillList ?? []).filter(Boolean);
		const warningCount = interactions?.warnings?.length ?? 0;
		const cautionCount = interactions?.cautions?.length ?? 0;

		if (pills.length === 0) {
			return '안녕하세요. 약 이름을 입력하거나 사진으로 약을 등록해 주세요.';
		}

		const base = `현재 등록된 약은 ${pills.join(', ')} 입니다.`;
		const warn = warningCount > 0 ? `경고가 ${warningCount}건 있습니다. 반드시 확인하세요.` : '치명적인 경고는 현재 없습니다.';
		const caution = cautionCount > 0 ? `주의 사항이 ${cautionCount}건 있습니다.` : '';
		const reportHint = aiReport ? 'AI 리포트도 함께 확인해 주세요.' : '';
		return [base, warn, caution, reportHint].filter(Boolean).join(' ');
	}, [pillList, interactions, aiReport]);

	if (!supported) return null;

	const koVoices = (voices ?? []).filter((v) => (v?.lang || '').toLowerCase().startsWith('ko'));
	const maleHints = ['injoon', 'in joon', '인준', 'male', 'man', 'minjun', '민준'];
	const femaleHints = ['sunhi', 'sun hi', '선희', 'heami', 'female', 'woman'];
	const hasKoMale = koVoices.some((v) => maleHints.some((h) => normalizeString(v?.name).includes(h)));
	const hasKoFemale = koVoices.some((v) => femaleHints.some((h) => normalizeString(v?.name).includes(h)));

	return (
		<section className="card">
			<h3 style={{ marginTop: 0 }}>음성 안내</h3>
			<p style={{ marginTop: 0, color: '#4A5568' }}>버튼을 누르면 현재 상태를 요약해 읽어드려요.</p>
			<div className="btn-row" style={{ marginTop: 6, alignItems: 'center' }}>
				<button
					type="button"
					onClick={() => {
						try { refreshVoices?.(); } catch { /* ignore */ }
					}}
				>
					보이스 새로고침
				</button>
				<button type="button" onClick={() => setShowDiagnostics((v) => !v)} style={{ marginLeft: 'auto' }}>
					{showDiagnostics ? '보이스 목록 닫기' : '보이스 목록 보기'}
				</button>
			</div>

			{showDiagnostics && (
				<div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: '1px solid #EDF2F7', background: '#FAFAFA' }}>
					<div className="meta" style={{ marginTop: 0 }}>
						voicesLoaded: <b>{String(Boolean(voicesLoaded))}</b> / 전체: <b>{voices?.length ?? 0}</b> / ko-KR 계열: <b>{koVoices.length}</b>
					</div>
					<div className="meta" style={{ marginTop: 6 }}>
						한국어 여성 힌트 감지: <b style={{ color: hasKoFemale ? '#2F855A' : '#C53030' }}>{hasKoFemale ? '예' : '아니오'}</b>
						<span style={{ marginLeft: 12 }}>
							한국어 남성 힌트 감지: <b style={{ color: hasKoMale ? '#2F855A' : '#C53030' }}>{hasKoMale ? '예' : '아니오'}</b>
						</span>
					</div>
					<div style={{ marginTop: 10, maxHeight: 220, overflow: 'auto' }}>
						<table style={{ width: '100%', borderCollapse: 'collapse' }}>
							<thead>
								<tr>
									<th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #E2E8F0' }}>name</th>
									<th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #E2E8F0' }}>lang</th>
									<th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #E2E8F0' }}>local</th>
									<th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #E2E8F0' }}>default</th>
								</tr>
							</thead>
							<tbody>
								{(voices ?? []).map((v) => (
									<tr key={`${v?.name}-${v?.lang}`}> 
										<td style={{ padding: '6px 8px', borderBottom: '1px solid #EDF2F7' }}>{v?.name}</td>
										<td style={{ padding: '6px 8px', borderBottom: '1px solid #EDF2F7' }}>{v?.lang}</td>
										<td style={{ padding: '6px 8px', borderBottom: '1px solid #EDF2F7' }}>{String(Boolean(v?.localService))}</td>
										<td style={{ padding: '6px 8px', borderBottom: '1px solid #EDF2F7' }}>{String(Boolean(v?.default))}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="meta" style={{ marginTop: 10 }}>
						팁: Windows 보이스팩 설치/변경 후에는 브라우저(Edge/Chrome)를 완전히 종료했다가 다시 열어야 목록이 갱신되는 경우가 많습니다.
					</div>
				</div>
			)}
			<div className="btn-row" style={{ alignItems: 'center' }}>
				<span style={{ color: '#4A5568' }}>목소리</span>
				<div className="segmented" role="group" aria-label="voice gender">
					<button
						type="button"
						className={voiceGender === 'female' ? 'active' : ''}
						onClick={() => onVoiceGenderChange?.('female')}
					>
						여성
					</button>
					<button
						onClick={() =>
							speak(script, {
								gender: 'male',
								engine: 'auto',
								fallbackToBrowserOnServerFail: true,
								// 'Minjun', 'Google 한국어', 'Heami' 등 남성 음성 키워드 추가
								preferredNames: ['InJoon', '인준', 'Minjun', '민준', 'Google 한국어', 'ko-KR-Standard-C', 'male']
							})
						}
						disabled={speaking}						
						type="button"
					>
						남성
					</button>
				</div>
			</div>

			<div className="btn-row" style={{ marginTop: 10 }}>
				<button
					onClick={() =>
						speak(script, {
							gender: voiceGender,
							engine: 'auto',
							fallbackToBrowserOnServerFail: true,
							preferredNames: voiceGender === 'male' ? ['InJoon', '인준', 'male'] : ['SunHi', '선희', 'female'],
						})
					}
					disabled={speaking}
					type="button"
				>
					{speaking ? '재생 중…' : '요약 읽기'}
				</button>
				<button
					onClick={() =>
						speak(script, { gender: 'female', engine: 'auto', fallbackToBrowserOnServerFail: true, preferredNames: ['SunHi', '선희', 'female'] })
					}
					disabled={speaking}
					type="button"
				>
					여성으로 읽기
				</button>
				<button
					onClick={() =>
						speak(script, { gender: 'male', engine: 'auto', fallbackToBrowserOnServerFail: true, preferredNames: ['InJoon', '인준', 'male'] })
					}
					disabled={speaking}
					type="button"
				>
					남성으로 읽기
				</button>
				<button onClick={cancel} disabled={!speaking} type="button">
					중지
				</button>
			</div>
		</section>
	);
}
