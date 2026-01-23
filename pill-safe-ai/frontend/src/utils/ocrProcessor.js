export function normalizeText(value) {
	if (!value) return '';
	return String(value)
		.toLowerCase()
		.replace(/\s+/g, '')
		.replace(/[\u200B-\u200D\uFEFF]/g, '')
		.replace(/[()[\]{}<>,.~`'"!?@#$%^&*+=:;\\|/-]/g, '');
}

export function extractOcrCandidates(rawOcrText) {
	const raw = (rawOcrText ?? '').toString();
	if (!raw.trim()) return [];

	const tokens = raw
		.split(/[\n\r\t\s]+/)
		.flatMap((t) => t.split(/[()[\]{}<>,.~`'"!?@#$%^&*+=:;\\|/]/))
		.map((t) => t.trim())
		.filter(Boolean);

	const unique = new Map();
	for (const token of tokens) {
		const normalized = normalizeText(token);
		if (!normalized) continue;
		if (!unique.has(normalized)) unique.set(normalized, token);
	}

	const candidates = Array.from(unique.values());

	candidates.sort((a, b) => {
		const na = normalizeText(a).length;
		const nb = normalizeText(b).length;
		return nb - na;
	});

	return candidates.slice(0, 12);
}

export function pickBestOcrCandidate(rawOcrText) {
	const candidates = extractOcrCandidates(rawOcrText);
	return candidates[0] ?? (rawOcrText ?? '').toString().trim();
}
