speechSynthesis.getVoices()
v.name(
    "SunHi", "Heami" = "woman",
    "Injoon" = "man"
)

const allVoices = window.speechSynthesis.getVoices();
const womanVoice = allVoices.find(v => v.lang === 'ko-KR' && (v.name.includes('SunHi') || v.name.includes('Heami')));
const manVoice = allVoices.find(v => v.lang === 'ko-KR' && v.name.includes('InJoon'));

const speak = (text, gender) => {
    const message = new SpeechSynthesisUtterance(text);
    message.voice = gender === 'woman' ? womanVoice : manVoice;
    window.speechSynthesis.speak(message);
};

state = gender === 'woman' ? sunhiVoice : injoonVoice

isLoaded

speakResult("분석이 완료되었습니다", "woman")