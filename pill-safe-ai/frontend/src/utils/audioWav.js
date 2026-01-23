// Minimal browser-side WAV encoder (PCM 16-bit, mono)

function floatTo16BitPCM(output, offset, input) {
	for (let i = 0; i < input.length; i++) {
		let s = Math.max(-1, Math.min(1, input[i]));
		output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		offset += 2;
	}
}

function writeString(view, offset, string) {
	for (let i = 0; i < string.length; i++) {
		view.setUint8(offset + i, string.charCodeAt(i));
	}
}

function encodeWavFromAudioBuffer(audioBuffer) {
	const numChannels = 1;
	const sampleRate = audioBuffer.sampleRate;
	const samples = audioBuffer.getChannelData(0);

	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);

	writeString(view, 0, 'RIFF');
	view.setUint32(4, 36 + samples.length * 2, true);
	writeString(view, 8, 'WAVE');
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * numChannels * 2, true);
	view.setUint16(32, numChannels * 2, true);
	view.setUint16(34, 16, true);
	writeString(view, 36, 'data');
	view.setUint32(40, samples.length * 2, true);

	floatTo16BitPCM(view, 44, samples);
	return buffer;
}

export async function blobToWav(blob) {
	const arrayBuffer = await blob.arrayBuffer();
	const audioContext = new (window.AudioContext || window.webkitAudioContext)();
	const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

	// Downmix to mono
	let mono;
	if (audioBuffer.numberOfChannels === 1) {
		mono = audioBuffer;
	} else {
		const length = audioBuffer.length;
		const output = audioContext.createBuffer(1, length, audioBuffer.sampleRate);
		const out = output.getChannelData(0);
		const ch0 = audioBuffer.getChannelData(0);
		const ch1 = audioBuffer.getChannelData(1);
		for (let i = 0; i < length; i++) out[i] = (ch0[i] + ch1[i]) * 0.5;
		mono = output;
	}

	return encodeWavFromAudioBuffer(mono);
}
