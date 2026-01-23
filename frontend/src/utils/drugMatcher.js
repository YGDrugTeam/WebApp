import drugDatabase from '../data/drugDatabase.json';
import medicalKnowledge from '../data/medicalKnowledge.json';
import { getMfdsCachedDrugs } from './mfdsCache';

function normalize(value) {
	return String(value ?? '')
		.toLowerCase()
		.replace(/\(.*?\)/g, ' ')
		.replace(/[^0-9a-zA-Z가-힣\s.+-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function scoreMatch(query, target) {
	if (!query || !target) return 0;
	if (query === target) return 100;
	if (target.includes(query)) return 85;
	if (query.includes(target)) return 80;

	// simple token overlap
	const qTokens = new Set(query.split(' ').filter(Boolean));
	const tTokens = new Set(target.split(' ').filter(Boolean));
	if (qTokens.size === 0 || tTokens.size === 0) return 0;
	let inter = 0;
	for (const t of qTokens) if (tTokens.has(t)) inter += 1;
	const union = qTokens.size + tTokens.size - inter;
	return Math.round((inter / union) * 60);
}

function getBrandDictionary() {
	const dict = medicalKnowledge?.brandDictionary;
	return Array.isArray(dict) ? dict : [];
}

function matchBrand(rawText) {
	const q = normalize(rawText);
	if (!q) return null;

	const dict = getBrandDictionary();
	let best = null;
	let bestScore = 0;
	for (const entry of dict) {
		const brand = normalize(entry?.brand);
		if (!brand) continue;
		const s = scoreMatch(q, brand);
		if (s > bestScore) {
			bestScore = s;
			best = entry;
		}
	}

	if (!best || bestScore < 60) return null;
	const ingredients = Array.isArray(best.ingredients) ? best.ingredients.filter(Boolean) : [];
	return { brand: best.brand, category: best.category, ingredients, score: bestScore };
}

function findDrugByIngredients(ingredients) {
	const items = Array.isArray(drugDatabase?.drugs) ? drugDatabase.drugs : [];
	if (!Array.isArray(ingredients) || ingredients.length === 0 || items.length === 0) return null;

	const ingSet = new Set(ingredients.map((x) => normalize(x)));
	let best = null;
	let bestScore = 0;

	for (const drug of items) {
		const actives = Array.isArray(drug?.activeIngredients) ? drug.activeIngredients : [];
		if (actives.length === 0) continue;
		let overlap = 0;
		for (const a of actives) {
			if (ingSet.has(normalize(a))) overlap += 1;
		}
		if (overlap === 0) continue;
		// prefer exact/full ingredient match
		const s = overlap * 40 + (overlap === ingSet.size ? 30 : 0);
		if (s > bestScore) {
			bestScore = s;
			best = drug;
		}
	}

	return best ? { drug: best, score: bestScore } : null;
}

export function matchDrug(rawText) {
	const q = normalize(rawText);
	if (!q) return null;

	const items = Array.isArray(drugDatabase?.drugs) ? drugDatabase.drugs : [];

	let best = null;
	let bestScore = 0;

	for (const drug of items) {
		const nameScore = scoreMatch(q, normalize(drug.name));
		let aliasScore = 0;
		for (const alias of drug.aliases ?? []) {
			aliasScore = Math.max(aliasScore, scoreMatch(q, normalize(alias)));
		}
		const score = Math.max(nameScore, aliasScore);
		if (score > bestScore) {
			bestScore = score;
			best = drug;
		}
	}

	// If local DB match is weak, try MFDS cached names (from previous searches)
	if (!best || bestScore < 60) {
		const mfdsItems = getMfdsCachedDrugs();
		let mfdsBest = null;
		let mfdsBestScore = 0;
		for (const it of mfdsItems) {
			const name = String(it?.itemName ?? '').trim();
			if (!name) continue;
			const s = scoreMatch(q, normalize(name));
			if (s > mfdsBestScore) {
				mfdsBestScore = s;
				mfdsBest = it;
			}
		}

		if (mfdsBest && mfdsBestScore >= 70) {
			return {
				canonicalName: String(mfdsBest.itemName ?? rawText).trim(),
				matched: true,
				score: mfdsBestScore,
				drug: null,
				inferred: { source: 'mfdsCache', entpName: mfdsBest.entpName, itemSeq: mfdsBest.itemSeq },
			};
		}
	}

	if (!best) {
		const brandHit = matchBrand(rawText);
		if (brandHit) {
			const byIng = findDrugByIngredients(brandHit.ingredients);
			if (byIng?.drug) {
				return {
					canonicalName: byIng.drug.name,
					matched: true,
					score: Math.max(70, brandHit.score),
					drug: byIng.drug,
					inferred: { source: 'brandDictionary', brand: brandHit.brand, category: brandHit.category, ingredients: brandHit.ingredients },
				};
			}
			return {
				canonicalName: String(rawText ?? '').trim(),
				matched: false,
				score: brandHit.score,
				drug: null,
				inferred: { source: 'brandDictionary', brand: brandHit.brand, category: brandHit.category, ingredients: brandHit.ingredients },
			};
		}
		return { canonicalName: rawText.trim(), matched: false, score: 0, drug: null };
	}

	const matched = bestScore >= 60;
	if (matched) {
		return {
		canonicalName: matched ? best.name : rawText.trim(),
		matched,
		score: bestScore,
		drug: best,
		};
	}

	const brandHit = matchBrand(rawText);
	if (brandHit) {
		const byIng = findDrugByIngredients(brandHit.ingredients);
		if (byIng?.drug) {
			return {
				canonicalName: byIng.drug.name,
				matched: true,
				score: Math.max(bestScore, brandHit.score, 70),
				drug: byIng.drug,
				inferred: { source: 'brandDictionary', brand: brandHit.brand, category: brandHit.category, ingredients: brandHit.ingredients },
			};
		}
		return {
			canonicalName: String(rawText ?? '').trim(),
			matched: false,
			score: Math.max(bestScore, brandHit.score),
			drug: null,
			inferred: { source: 'brandDictionary', brand: brandHit.brand, category: brandHit.category, ingredients: brandHit.ingredients },
		};
	}

	return {
		canonicalName: rawText.trim(),
		matched: false,
		score: bestScore,
		drug: null,
	};
}

export function getDrugDatabase() {
	return drugDatabase;
}
