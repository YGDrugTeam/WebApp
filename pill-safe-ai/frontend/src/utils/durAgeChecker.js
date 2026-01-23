import durAge from '../data/durAgeContraindications.json';

function normalizeKey(text) {
	return String(text ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '');
}

function ageMatchesRange(ageYears, r) {
	if (ageYears == null) return false;
	const age = Number(ageYears);
	if (!Number.isFinite(age)) return false;

	let ok = true;
	if (r.minAge != null) ok = ok && (r.minInclusive ? age >= r.minAge : age > r.minAge);
	if (r.maxAge != null) ok = ok && (r.maxInclusive ? age <= r.maxAge : age < r.maxAge);
	return ok;
}

function ruleAppliesToAge(ageYears, rule) {
	const ranges = Array.isArray(rule?.ageRanges) ? rule.ageRanges : [];
	if (!ranges.length) return false;
	return ranges.some((r) => ageMatchesRange(ageYears, r));
}

function formatRuleMeta(rule) {
	const bits = [];
	if (rule.formName) bits.push(`제형: ${rule.formName}`);
	if (rule.className) bits.push(`분류: ${rule.className}`);
	if (rule.notificationDate) bits.push(`고시: ${rule.notificationDate}`);
	return bits.length ? bits.join(' · ') : null;
}

export function computeDurAgeWarnings(matchedDrugs, ageYears) {
	const drugs = Array.isArray(matchedDrugs) ? matchedDrugs : [];
	if (ageYears == null || ageYears === '') return [];

	const rules = durAge?.rules ?? [];
	if (!Array.isArray(rules) || rules.length === 0) return [];

	const byKey = new Map();
	for (const r of rules) {
		const key = r?.ingredientKey ? normalizeKey(r.ingredientKey) : normalizeKey(r?.ingredientNameEn);
		if (!key) continue;
		if (!byKey.has(key)) byKey.set(key, []);
		byKey.get(key).push(r);
	}

	const ingredientSet = new Set();
	for (const d of drugs) {
		for (const ing of d?.ingredients ?? []) {
			ingredientSet.add(normalizeKey(ing));
		}
	}

	const warnings = [];

	for (const ingredientKey of ingredientSet) {
		const candidates = byKey.get(ingredientKey) ?? [];
		const applicable = candidates.filter((r) => ruleAppliesToAge(ageYears, r));
		if (applicable.length === 0) continue;

		// Combine a small number of rows into one warning per ingredient.
		const top = applicable[0];
		const name = top.ingredientNameKo || top.ingredientNameEn || ingredientKey;
		const details = applicable
			.slice(0, 3)
			.map((r) => {
				const meta = formatRuleMeta(r);
				const text = r.prohibitContent || r.remark || '연령 금기/주의 항목(상세 없음)';
				return meta ? `${text} (${meta})` : text;
			})
			.filter(Boolean);

		warnings.push({
			kind: 'dur-age',
			severity: 'high',
			title: `특정 연령대 금기(DUR): ${name}`,
			message:
				details.length === 1
					? `만 ${ageYears}세 기준 금기/주의 항목이 있습니다: ${details[0]}`
					: `만 ${ageYears}세 기준 금기/주의 항목이 있습니다: ${details.join(' / ')}`,
			relatedIngredients: [ingredientKey]
		});
	}

	return warnings;
}
