function normalize(value) {
	return String(value ?? '')
	.replace(/[()[\]{}]/g, ' ')
		.replace(/[^0-9a-zA-Z가-힣\s.+-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function normalizeOcrText(text) {
	return normalize(text);
}

export function extractDrugCandidates(text) {
	const normalized = normalize(text);
	if (!normalized) return [];

	const tokens = normalized
		.split(/\s|,|\/|\n|\t|\r/)
		.map((t) => t.trim())
		.filter(Boolean);

	// preserve longer chunks too (e.g., "타이레놀 500mg")
	const chunks = normalized
		.split(/\n|\r/)
		.map((line) => line.trim())
		.filter(Boolean);

	const candidates = [...new Set([...chunks, ...tokens])]
		.filter((c) => c.length >= 2)
		.slice(0, 25);

	return candidates;
}
