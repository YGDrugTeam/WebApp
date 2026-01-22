import medicalKnowledge from '../data/medicalKnowledge.json';
import { getDrugDatabase } from './drugMatcher';

function normalizeText(value) {
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

	const qTokens = new Set(query.split(' ').filter(Boolean));
	const tTokens = new Set(target.split(' ').filter(Boolean));
	if (qTokens.size === 0 || tTokens.size === 0) return 0;
	let inter = 0;
	for (const t of qTokens) if (tTokens.has(t)) inter += 1;
	const union = qTokens.size + tTokens.size - inter;
	return Math.round((inter / union) * 60);
}

function inferIngredientsFromBrandDictionary(rawName, knowledge) {
	const dict = Array.isArray(knowledge?.brandDictionary) ? knowledge.brandDictionary : [];
	if (!rawName || dict.length === 0) return null;

	const q = normalizeText(rawName);
	if (!q) return null;

	let best = null;
	let bestScore = 0;
	for (const entry of dict) {
		const brand = normalizeText(entry?.brand);
		if (!brand) continue;
		const s = scoreMatch(q, brand);
		if (s > bestScore) {
			bestScore = s;
			best = entry;
		}
	}

	if (!best || bestScore < 60) return null;
	const ingredients = Array.isArray(best.ingredients) ? best.ingredients : [];
	return { ingredients, brand: best.brand, category: best.category, score: bestScore };
}

function uniquePairs(items) {
	const out = [];
	for (let i = 0; i < items.length; i += 1) {
		for (let j = i + 1; j < items.length; j += 1) {
			out.push([items[i], items[j]]);
		}
	}
	return out;
}

export function checkInteractions(drugNames, options = {}) {
	const names = (drugNames ?? []).map((n) => String(n ?? '').trim()).filter(Boolean);
	const db = getDrugDatabase();
	const drugs = Array.isArray(db?.drugs) ? db.drugs : [];
	const knowledge = medicalKnowledge ?? {};

	const byName = new Map(drugs.map((d) => [d.name, d]));

	const ingredientsByDrug = {};
	const inferredByDrug = {};
	for (const name of names) {
		const entry = byName.get(name);
		if (entry?.activeIngredients?.length) {
			ingredientsByDrug[name] = entry.activeIngredients;
			continue;
		}

		const inferred = inferIngredientsFromBrandDictionary(name, knowledge);
		if (inferred?.ingredients?.length) {
			ingredientsByDrug[name] = inferred.ingredients;
			inferredByDrug[name] = { brand: inferred.brand, category: inferred.category, score: inferred.score };
			continue;
		}

		ingredientsByDrug[name] = [];
	}

	const warnings = [];
	const cautions = [];
	const info = [];

	// Duplicate active ingredient
	const ingredientToDrugs = new Map();
	for (const [drugName, ingredients] of Object.entries(ingredientsByDrug)) {
		for (const ing of ingredients) {
			const key = String(ing).toLowerCase();
			if (!ingredientToDrugs.has(key)) ingredientToDrugs.set(key, []);
			ingredientToDrugs.get(key).push(drugName);
		}
	}
	for (const [ing, ds] of ingredientToDrugs.entries()) {
		if (ds.length >= 2) {
			warnings.push({
				severity: 'warning',
				title: '성분 중복 복용 가능성',
				message: `${ds.join(' + ')} 에 같은 성분(${ing})이 포함되어 있을 수 있어요. 중복 복용 여부를 확인하세요.`,
				related: ds,
			});
		}
	}

	// Pairwise interaction rules
	const rules = Array.isArray(knowledge?.interactions) ? knowledge.interactions : [];
	const pairs = uniquePairs(names);

	for (const [a, b] of pairs) {
		const aIngs = ingredientsByDrug[a] ?? [];
		const bIngs = ingredientsByDrug[b] ?? [];

		for (const rule of rules) {
			const left = String(rule?.ingredientA ?? '').toLowerCase();
			const right = String(rule?.ingredientB ?? '').toLowerCase();
			if (!left || !right) continue;

			const hasLeft = aIngs.some((x) => String(x).toLowerCase() === left) && bIngs.some((x) => String(x).toLowerCase() === right);
			const hasRight = aIngs.some((x) => String(x).toLowerCase() === right) && bIngs.some((x) => String(x).toLowerCase() === left);
			if (!hasLeft && !hasRight) continue;

			const payload = {
				severity: rule.severity ?? 'caution',
				title: rule.title ?? '상호작용 주의',
				message: rule.message ?? `${a} 과(와) ${b} 병용 시 주의가 필요합니다.`,
				related: [a, b],
			};

			if (payload.severity === 'danger' || payload.severity === 'warning') warnings.push(payload);
			else cautions.push(payload);
		}
	}

	// Per-drug cautions from DB
	for (const name of names) {
		const entry = byName.get(name);
		for (const c of entry?.cautions ?? []) {
			cautions.push({ severity: 'caution', title: `${name} 복용 주의`, message: c, related: [name] });
		}
	}

	// General tips
	for (const tip of knowledge?.generalTips ?? []) {
		info.push({ severity: 'info', title: '복용 팁', message: tip, related: [] });
	}

	// Age/profile-specific guides (optional)
	const ageGroup = String(options?.ageGroup ?? '').trim();
	if (ageGroup) {
		const guides = knowledge?.ageSpecificGuides ?? {};
		const guide = guides?.[ageGroup];
		if (guide) {
			const target = String(guide.target ?? '').trim();
			const recs = Array.isArray(guide.recommendations) ? guide.recommendations.filter(Boolean) : [];
			if (recs.length) {
				info.push({
					severity: 'info',
					title: target ? `${target} 추천` : '추천',
					message: `추천 성분/제품: ${recs.join(', ')}`,
					related: [],
				});
			}
			const caution = String(guide.caution ?? '').trim();
			if (caution) {
				cautions.push({
					severity: 'caution',
					title: target ? `${target} 주의` : '주의',
					message: caution,
					related: [],
				});
			}
		}
	}

	return { warnings, cautions, info, ingredientsByDrug, inferredByDrug };
}
