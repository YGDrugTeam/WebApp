import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_LANG = 'ko-KR';

function normalizeString(value) {
    return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function pickVoice(voices, { lang = DEFAULT_LANG, gender = 'female', preferredNames = [] } = {}) {
    if (!Array.isArray(voices) || voices.length === 0) return null;

    const normalizedPreferredNames = preferredNames.map((n) => normalizeString(n)).filter(Boolean);

    const byLang = voices.filter((v) => (v?.lang || '').toLowerCase().startsWith(lang.toLowerCase()));
    const candidates = byLang.length > 0 ? byLang : voices;

    const matchPreferred = candidates.find((v) => {
        const vn = normalizeString(v?.name);
        return normalizedPreferredNames.some((p) => vn.includes(p));
    });
    if (matchPreferred) return matchPreferred;

    const femaleHints = ['sunhi', 'sun hi', '선희', 'heami', 'yuna', 'female', 'woman'];
    // maleHints에 'minjun', 'google 한국어' 등 추가
    const maleHints = ['injoon', 'in joon', 'in-joon', '인준', 'minjun', '민jun', 'male', 'man', 'google 한국어'];
    const hints = gender === 'male' ? maleHints : femaleHints;
    const hinted = candidates.find((v) => hints.some((h) => normalizeString(v?.name).includes(h)));
    if (hinted) return hinted;

    return candidates[0] ?? null;
}

export default function useSpeechSynthesis(defaultOptions = {}) {
    const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

    const ttsUrl = defaultOptions.ttsUrl
        ?? process.env.REACT_APP_TTS_URL
        ?? 'http://localhost:8000/tts';

    const [voices, setVoices] = useState([]);
    const [voicesLoaded, setVoicesLoaded] = useState(false);
    const [speaking, setSpeaking] = useState(false);

    const lastUtteranceRef = useRef(null);
    const audioRef = useRef(null);
    const abortRef = useRef(null);

    const refreshVoices = useCallback(() => {
        if (!supported) return;
        const next = window.speechSynthesis.getVoices();
        setVoices(next);
        if (next && next.length > 0) setVoicesLoaded(true);
    }, [supported]);

    useEffect(() => {
        if (!supported) return undefined;

        refreshVoices();
        const handler = () => refreshVoices();
        window.speechSynthesis.addEventListener?.('voiceschanged', handler);
        window.speechSynthesis.onvoiceschanged = handler;

        return () => {
            try {
                window.speechSynthesis.removeEventListener?.('voiceschanged', handler);
            } catch {
                // ignore
            }
            if (window.speechSynthesis.onvoiceschanged === handler) {
                window.speechSynthesis.onvoiceschanged = null;
            }
        };
    }, [supported, refreshVoices]);

    const cancel = useCallback(() => {
        try {
            abortRef.current?.abort?.();
        } catch {
            // ignore
        }
        abortRef.current = null;

        if (audioRef.current) {
            try {
                audioRef.current.pause();
                audioRef.current.src = '';
            } catch {
                // ignore
            }
            audioRef.current = null;
        }

        if (supported) window.speechSynthesis.cancel();
        setSpeaking(false);
        lastUtteranceRef.current = null;
    }, [supported]);

    const speakViaServer = useCallback(
        async (text, options) => {
            const controller = new AbortController();
            abortRef.current = controller;

            const res = await fetch(ttsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    gender: options.gender,
                }),
                signal: controller.signal,
            });
            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);
            if (!contentType.includes('audio/')) {
                // Server replied with JSON error or other non-audio payload
                throw new Error(`TTS response is not audio: ${contentType || 'unknown'}`);
            }

            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);

            return await new Promise((resolve, reject) => {
                const audio = new Audio(objectUrl);
                audioRef.current = audio;

                const cleanup = () => {
                    try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
                    if (audioRef.current === audio) audioRef.current = null;
                    abortRef.current = null;
                };

                audio.onended = () => {
                    cleanup();
                    resolve(true);
                };
                audio.onerror = () => {
                    cleanup();
                    reject(new Error('Audio playback failed'));
                };

                audio.play()
                    .then(() => {
                        setSpeaking(true);
                    })
                    .catch((err) => {
                        cleanup();
                        reject(err);
                    });
            });
        },
        [ttsUrl]
    );

    const speak = useCallback(
        (text, options = {}) => {
            const content = String(text ?? '').trim();
            if (!content) return false;

            const {
                lang = defaultOptions.lang ?? DEFAULT_LANG,
                gender = defaultOptions.gender ?? 'female',
                preferredNames = defaultOptions.preferredNames ?? [],
                rate = defaultOptions.rate ?? 1,
                pitch = defaultOptions.pitch ?? 1,
                volume = defaultOptions.volume ?? 1,
                enqueue = false,
                engine = defaultOptions.engine ?? 'auto', // 'auto' | 'server' | 'browser'
                fallbackToBrowserOnServerFail = defaultOptions.fallbackToBrowserOnServerFail ?? (engine === 'auto'),
                maxVoiceLoadWaitMs = defaultOptions.maxVoiceLoadWaitMs ?? 900,
            } = options;

            // cancel any existing speech/audio unless enqueue
            if (!enqueue) cancel();

            const serverOptions = { lang, gender, rate, pitch, volume, preferredNames };

            const canUseBrowser = supported;
            const shouldTryServer = engine === 'server' || engine === 'auto';
            const shouldUseBrowser = engine === 'browser' || engine === 'auto' || Boolean(fallbackToBrowserOnServerFail);

            const speakViaBrowser = () => {
                if (!canUseBrowser) return false;
                const start = Date.now();
                let attempt = 0;

                const trySpeak = () => {
                    attempt += 1;
                    try {
                        if (!enqueue) window.speechSynthesis.cancel();
                        const utterance = new window.SpeechSynthesisUtterance(content);
                        utterance.lang = lang;
                        utterance.rate = rate;
                        utterance.pitch = pitch;
                        utterance.volume = volume;

                        const voice = pickVoice(window.speechSynthesis.getVoices(), { lang, gender, preferredNames });
                        if (voice) utterance.voice = voice;

                        utterance.onstart = () => setSpeaking(true);
                        utterance.onend = () => {
                            setSpeaking(false);
                            if (lastUtteranceRef.current === utterance) lastUtteranceRef.current = null;
                        };
                        utterance.onerror = () => {
                            setSpeaking(false);
                            if (lastUtteranceRef.current === utterance) lastUtteranceRef.current = null;
                        };
                        lastUtteranceRef.current = utterance;
                        window.speechSynthesis.speak(utterance);
                        return true;
                    } catch {
                        setSpeaking(false);
                        return false;
                    }
                };

                const voicesNow = window.speechSynthesis.getVoices();
                if (voicesNow && voicesNow.length > 0) return trySpeak();

                try { refreshVoices(); } catch { /* ignore */ }
                const tick = () => {
                    const nextVoices = window.speechSynthesis.getVoices();
                    if (nextVoices && nextVoices.length > 0) return trySpeak();
                    if (Date.now() - start >= maxVoiceLoadWaitMs) return trySpeak();
                    setTimeout(tick, Math.min(150, 50 + attempt * 20));
                    return true;
                };
                return tick();
            };

            if (shouldTryServer) {
                // fire-and-forget promise; we keep API sync by returning true
                speakViaServer(content, serverOptions)
                    .then(() => setSpeaking(false))
                    .catch(() => {
                        if (!shouldUseBrowser || !canUseBrowser) {
                            setSpeaking(false);
                            return;
                        }

                        speakViaBrowser();
                    });

                return true;
            }

            // browser-only
            if (!canUseBrowser) return false;
			speakViaBrowser();
			return true;
        },
        [supported, defaultOptions, cancel, speakViaServer, refreshVoices]
    );

    const api = useMemo(
        () => ({
            supported,
            voices,
            voicesLoaded,
            speaking,
            speak,
            cancel,
            refreshVoices,
        }),
        [supported, voices, voicesLoaded, speaking, speak, cancel, refreshVoices]
    );

    return api;
}