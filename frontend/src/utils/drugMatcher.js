import drugDatabase from '../data/drugDatabase.json';
import { normalizeText } from './ocrProcessor';

function levenshteinDistance(a, b) {
	const s = a ?? '';
	const t = b ?? '';
	if (s === t) return 0;
	if (!s) return t.length;
	if (!t) return s.length;

	const dp = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1));
	for (let i = 0; i <= s.length; i += 1) dp[i][0] = i;
	for (let j = 0; j <= t.length; j += 1) dp[0][j] = j;

	for (let i = 1; i <= s.length; i += 1) {
		for (let j = 1; j <= t.length; j += 1) {
			const cost = s[i - 1] === t[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost
			);
		}
	}

	return dp[s.length][t.length];
}

function similarityScore(a, b) {
	const na = normalizeText(a);
	const nb = normalizeText(b);
	if (!na || !nb) return 0;
	if (na === nb) return 1;
	if (na.includes(nb) || nb.includes(na)) return 0.86;
	const dist = levenshteinDistance(na, nb);
	const maxLen = Math.max(na.length, nb.length);
	return Math.max(0, 1 - dist / maxLen);
}

function getDrugSearchKeys(drug) {
	return [drug.brandNameKo, drug.genericName, ...(drug.aliases ?? [])].filter(Boolean);
}

export function matchDrugName(input) {
	const rawInput = (input ?? '').toString().trim();
	const normalizedInput = normalizeText(rawInput);

	if (!normalizedInput) {
		return {
			input: rawInput,
			normalizedInput,
			best: null,
			candidates: []
		};
	}

	const scored = (drugDatabase.drugs ?? []).map((drug) => {
		const keys = getDrugSearchKeys(drug);
		let bestKey = null;
		let bestScore = 0;
		for (const key of keys) {
			const score = similarityScore(rawInput, key);
			if (score > bestScore) {
				bestScore = score;
				bestKey = key;
			}
		}
		return { drug, score: bestScore, matchedBy: bestKey };
	});

	scored.sort((a, b) => b.score - a.score);
	const top = scored[0];
	const candidates = scored.slice(0, 5).filter((c) => c.score > 0.25);

	return {
		input: rawInput,
		normalizedInput,
		best: top && top.score >= 0.5 ? top : null,
		candidates
	};
}

export function formatDrugDisplay(drugItem) {
	if (!drugItem) return '';
	const matched = drugItem.match?.drug;
	if (matched) return matched.brandNameKo;
	return drugItem.rawName;
}
