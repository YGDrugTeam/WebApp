speechSynthesis.getVoices()
v.name(
    "SunHi", "Heami" = "woman",
    "Injoon" = "man"
)

const allVoices = window.speechSynthesis.getVoices();
const womanVoice = allVoices.find(v => v.lang === 'ko-KR' && (v.name.includes('SunHi') || v.name.includes('Heami')));
const manVoice = allVoices.find(v => v.lang === 'ko-KR' && v.name.includes('InJoon'));

isLoaded