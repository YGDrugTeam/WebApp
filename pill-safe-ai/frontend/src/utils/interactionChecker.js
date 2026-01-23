import medicalKnowledge from '../data/medicalKnowledge.json';
import { computeDurAgeWarnings } from './durAgeChecker';

function severityRank(severity) {
	switch (severity) {
		case 'high':
			return 3;
		case 'medium':
			return 2;
		case 'low':
			return 1;
		default:
			return 0;
	}
}

function sortBySeverityDesc(a, b) {
	return severityRank(b.severity) - severityRank(a.severity);
}

export function computeInteractions(drugItems) {
	const ageYears = arguments.length > 1 ? arguments[1]?.ageYears ?? null : null;
	const items = Array.isArray(drugItems) ? drugItems : [];
	const matchedDrugs = items
		.map((d) => d.match?.drug)
		.filter(Boolean);

	const ingredientCounts = new Map();
	for (const drug of matchedDrugs) {
		for (const ingredient of drug.ingredients ?? []) {
			ingredientCounts.set(ingredient, (ingredientCounts.get(ingredient) ?? 0) + 1);
		}
	}

	const warnings = [];

	for (const rule of medicalKnowledge.ingredientDuplicateRules ?? []) {
		const count = ingredientCounts.get(rule.ingredient) ?? 0;
		if (count >= 2) {
			warnings.push({
				kind: 'duplicate-ingredient',
				severity: rule.severity,
				title: rule.title,
				message: rule.message,
				relatedIngredients: [rule.ingredient]
			});
		}
	}

	const ingredientSet = new Set();
	for (const ingredient of ingredientCounts.keys()) ingredientSet.add(ingredient);

	for (const pair of medicalKnowledge.interactionPairs ?? []) {
		const a = pair.aIngredient;
		const b = pair.bIngredient;
		if (ingredientSet.has(a) && ingredientSet.has(b)) {
			warnings.push({
				kind: 'pair',
				severity: pair.severity,
				title: pair.title,
				message: pair.message,
				relatedIngredients: [a, b]
			});
		}
	}

	// DUR: age contraindications
	for (const w of computeDurAgeWarnings(matchedDrugs, ageYears)) {
		warnings.push(w);
	}

	warnings.sort(sortBySeverityDesc);

	return {
		disclaimer: medicalKnowledge.disclaimer,
		warnings,
		ingredientCounts: Object.fromEntries(ingredientCounts.entries())
	};
}
