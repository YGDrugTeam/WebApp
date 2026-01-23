import { useCallback, useMemo, useRef, useState } from 'react';

export function useSpeechRecognition({ lang = 'ko-KR' } = {}) {
	const Recognition = useMemo(() => {
		return window.SpeechRecognition || window.webkitSpeechRecognition || null;
	}, []);

	const recognitionRef = useRef(null);
	const [isListening, setIsListening] = useState(false);
	const [lastTranscript, setLastTranscript] = useState('');
	const [error, setError] = useState(null);

	const supported = Boolean(Recognition);

	const stop = useCallback(() => {
		try {
			recognitionRef.current?.stop?.();
		} catch {
			// ignore
		}
		setIsListening(false);
	}, []);

	const start = useCallback(() => {
		if (!Recognition) return;
		setError(null);
		setLastTranscript('');

		const r = new Recognition();
		r.lang = lang;
		r.interimResults = false;
		r.maxAlternatives = 1;

		r.onstart = () => setIsListening(true);
		r.onend = () => setIsListening(false);
		r.onerror = (e) => {
			setError(e?.error || 'speech-recognition-error');
		};
		r.onresult = (e) => {
			try {
				const text = e?.results?.[0]?.[0]?.transcript || '';
				setLastTranscript(text);
			} catch {
				setLastTranscript('');
			}
		};

		recognitionRef.current = r;
		try {
			r.start();
		} catch (e) {
			setError(String(e?.message || e));
			setIsListening(false);
		}
	}, [Recognition, lang]);

	return {
		supported,
		isListening,
		lastTranscript,
		error,
		start,
		stop
	};
}
