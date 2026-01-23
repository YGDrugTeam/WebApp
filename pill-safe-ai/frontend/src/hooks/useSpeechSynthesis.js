import { useCallback, useEffect, useMemo, useState } from 'react';

function pickKoreanVoice(voices, preferredGender) {
    const ko = (voices ?? []).filter((v) => (v.lang ?? '').toLowerCase().startsWith('ko'));
    if (ko.length === 0) return null;

    const name = (v) => (v.name ?? '').toLowerCase();
    if (preferredGender === 'female') {
        return (
            ko.find((v) => name(v).includes('sunhi') || name(v).includes('heami')) ??
            ko[0]
        );
    }

    if (preferredGender === 'male') {
        return ko.find((v) => name(v).includes('injoon') || name(v).includes('in joon')) ?? ko[0];
    }

    return ko[0];
}

export function useSpeechSynthesis({ lang = 'ko-KR', rate = 1.02, pitch = 1, volume = 1, preferredGender } = {}) {
    const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    const [voices, setVoices] = useState([]);
    const [isSpeaking, setIsSpeaking] = useState(false);

    useEffect(() => {
        if (!supported) return undefined;

        const update = () => setVoices(window.speechSynthesis.getVoices());
        update();
        window.speechSynthesis.onvoiceschanged = update;

        return () => {
            if (window.speechSynthesis.onvoiceschanged === update) {
                window.speechSynthesis.onvoiceschanged = null;
            }
        };
    }, [supported]);

    const voice = useMemo(() => pickKoreanVoice(voices, preferredGender), [voices, preferredGender]);

    const cancel = useCallback(() => {
        if (!supported) return;
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
    }, [supported]);

    const speak = useCallback(
        (text) => {
            if (!supported) return false;
            const value = (text ?? '').toString().trim();
            if (!value) return false;

            window.speechSynthesis.cancel();

            const utterance = new window.SpeechSynthesisUtterance(value);
            utterance.lang = lang;
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.volume = volume;
            if (voice) utterance.voice = voice;

            utterance.onstart = () => setIsSpeaking(true);
            utterance.onend = () => setIsSpeaking(false);
            utterance.onerror = () => setIsSpeaking(false);

            window.speechSynthesis.speak(utterance);
            return true;
        },
        [supported, lang, rate, pitch, volume, voice]
    );

    return {
        supported,
        isSpeaking,
        speak,
        cancel,
        voiceName: voice?.name ?? null
    };
}
