import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

function buildSummary(drugItems, interactionResult) {
	const items = Array.isArray(drugItems) ? drugItems : [];
	const warnings = interactionResult?.warnings ?? [];

	const names = items
		.map((i) => i.match?.drug?.brandNameKo ?? i.rawName)
		.filter(Boolean);

	const intro = names.length ? `등록된 약은 ${names.join(', ')} 입니다.` : '등록된 약이 없습니다.';

	if (warnings.length === 0) {
		return `${intro} 현재 데이터 기준으로 큰 병용 경고는 없습니다. 그래도 복용 전에는 전문가와 상담하세요.`;
	}

	const top = warnings[0];
	const countText = warnings.length === 1 ? '1건의 경고가 있습니다.' : `${warnings.length}건의 경고가 있습니다.`;
	return `${intro} ${countText} 가장 중요한 경고는 ${top.title} 입니다. ${top.message} 안전을 위해 의사 또는 약사와 상담하세요.`;
}

export default function VoiceGuidePlayer({ drugItems, interactionResult }) {
	const [preferredGender, setPreferredGender] = useState('female');
	const [isLoading, setIsLoading] = useState(false);
	const [audioUrl, setAudioUrl] = useState(null);
	const [backendError, setBackendError] = useState(null);
	const [ttsStatus, setTtsStatus] = useState(null);
	const audioRef = useRef(null);
	const azureConfigured = Boolean(ttsStatus?.azure?.configured);

	useEffect(() => {
		try {
			const stored = window.localStorage.getItem('pillSafe.voiceGender');
			if (stored === 'female' || stored === 'male') setPreferredGender(stored);
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await axios.get('http://localhost:8000/tts/status');
				if (!cancelled) setTtsStatus(res?.data ?? null);
			} catch {
				if (!cancelled) setTtsStatus(null);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		try {
			window.localStorage.setItem('pillSafe.voiceGender', preferredGender);
		} catch {
			// ignore
		}
	}, [preferredGender]);

	const { supported, speak, cancel, voiceName } = useSpeechSynthesis({ preferredGender });

	const summary = useMemo(() => buildSummary(drugItems, interactionResult), [drugItems, interactionResult]);

	useEffect(() => {
		return () => {
			if (audioUrl) URL.revokeObjectURL(audioUrl);
		};
	}, [audioUrl]);

	const stopAudio = () => {
		try {
			if (audioRef.current) {
				audioRef.current.pause();
				audioRef.current.currentTime = 0;
			}
		} catch {
			// ignore
		}
	};

	const playViaBackendTts = async () => {
		setIsLoading(true);
		setBackendError(null);
		stopAudio();
		cancel();

		try {
			const response = await axios.post(
				'http://localhost:8000/tts',
				{ text: summary, gender: preferredGender },
				{ responseType: 'blob' }
			);

			const url = URL.createObjectURL(response.data);
			if (audioUrl) URL.revokeObjectURL(audioUrl);
			setAudioUrl(url);

			// 다음 렌더에서 ref가 붙을 수 있어 즉시/지연 둘 다 시도
			setTimeout(() => {
				if (audioRef.current) {
					audioRef.current.play().catch(() => {
						// autoplay 정책 등으로 실패할 수 있음
					});
				}
			}, 0);
		} catch (e) {
			const status = e?.response?.status;
			let detail = null;
			try {
				if (e?.response?.data instanceof Blob) {
					detail = await e.response.data.text();
				}
			} catch {
				// ignore
			}

			const raw = `${detail || ''}`;
			const lower = raw.toLowerCase();

			let friendly = '서버 TTS 생성에 실패했습니다.';
			if (lower.includes('azure=not configured')) {
				friendly = 'Azure TTS가 설정되지 않았습니다. 서버에 AZURE_SPEECH_KEY/AZURE_SPEECH_REGION을 설정해 주세요.';
			} else if (lower.includes('403')) {
				friendly = '현재 네트워크/환경에서 Edge TTS 접속이 차단된 것으로 보입니다(403). Azure TTS 설정을 권장합니다.';
			} else if (status === 502) {
				friendly = 'TTS 제공자(Edge/Azure) 호출에 실패했습니다. 잠시 후 다시 시도하거나 Azure TTS 설정을 확인해 주세요.';
			}

			setBackendError({
				title: friendly,
				technical: `요청 실패${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`
			});

			// 폴백: 브라우저 TTS
			speak(summary);
		} finally {
			setIsLoading(false);
		}
	};

	if (!supported) {
		return (
			<div className="card muted">
				이 브라우저는 음성 안내(Web Speech API)를 지원하지 않습니다.
			</div>
		);
	}

	return (
		<div className="card">
			<div className="card__row">
				<div>
					<div className="card__title">음성 안내</div>
					<div className="card__subtitle">
						서버 TTS(Edge/Azure)로 음성을 생성합니다. {voiceName ? `(브라우저 폴백 보이스: ${voiceName})` : ''}
					</div>
				</div>
				<div className="row-actions">
					<button className="btn" type="button" onClick={playViaBackendTts} disabled={isLoading}>
						{isLoading ? '생성 중...' : '요약 듣기'}
					</button>
					<button
						className="btn btn-secondary"
						type="button"
						onClick={() => {
							stopAudio();
							cancel();
						}}
					>
						정지
					</button>
				</div>
			</div>

			<div className="segmented" style={{ marginTop: 10 }}>
				<button
					type="button"
					className={preferredGender === 'female' ? 'segmented__btn segmented__btn--active' : 'segmented__btn'}
					onClick={() => {
						stopAudio();
						cancel();
						setPreferredGender('female');
					}}
				>
					여성 목소리
				</button>
				<button
					type="button"
					className={preferredGender === 'male' ? 'segmented__btn segmented__btn--active' : 'segmented__btn'}
					onClick={() => {
						stopAudio();
						cancel();
						setPreferredGender('male');
					}}
				>
					남성 목소리{!azureConfigured ? <span className="badge" style={{ marginLeft: 8 }}>Azure 권장</span> : null}
				</button>
			</div>

			{preferredGender === 'male' && !azureConfigured ? (
				<div className="callout callout--warning" style={{ marginTop: 10 }}>
					<div className="callout__title">남성 목소리 안정성 안내</div>
					<div className="callout__body">
						현재 환경에서는 Edge TTS가 차단(403)되는 경우가 있어, 남성 보이스는 Azure TTS 설정을 권장합니다.
					</div>
				</div>
			) : null}

			{ttsStatus ? (
				<div className="callout callout--info" style={{ marginTop: 10 }}>
					<div className="callout__title">서버 TTS 상태</div>
					<div className="callout__body">
						Edge: 사용 시도함 · Azure: {ttsStatus.azure?.configured ? '설정됨' : '미설정'}
					</div>
					{!ttsStatus.azure?.configured ? (
						<div className="callout__body" style={{ marginTop: 6 }}>
								PowerShell 예시: <span className="mono">$env:AZURE_SPEECH_KEY="YOUR_KEY"</span> /{' '}
								<span className="mono">$env:AZURE_SPEECH_REGION="koreacentral"</span>
								<span className="mono" style={{ display: 'block', marginTop: 6 }}>$env:AZURE_API_KEY="YOUR_KEY"</span>
								<span className="mono" style={{ display: 'block', marginTop: 4 }}>$env:AZURE_REGION="koreacentral"</span>
						</div>
					) : null}
				</div>
			) : null}

			{backendError ? (
				<div className="callout callout--warning" style={{ marginTop: 10 }}>
					<div className="callout__title">{backendError.title}</div>
					<div className="callout__body">브라우저 음성으로 대신 안내합니다.</div>
					<details style={{ marginTop: 8 }}>
						<summary className="muted">기술 정보 보기</summary>
						<div className="mono" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{backendError.technical}</div>
					</details>
				</div>
			) : null}

			{audioUrl ? (
				<audio ref={audioRef} src={audioUrl} controls style={{ width: '100%', marginTop: 10 }} />
			) : null}

			<div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
				{summary}
			</div>
		</div>
	);
}
