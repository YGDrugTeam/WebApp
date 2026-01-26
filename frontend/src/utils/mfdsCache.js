const STORAGE_KEY = 'mediclens.mfdsCache.v1';
const LEGACY_STORAGE_KEY = 'pillSafe.mfdsCache.v1';
const MAX_ITEMS = 2000;

function safeJsonParse(value, fallback) {
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}

function normalize(value) {
	return String(value ?? '')
		.toLowerCase()
		.replace(/\(.*?\)/g, ' ')
		.replace(/[^0-9a-zA-Z가-힣\s.+-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function readCache() {
	if (typeof window === 'undefined' || !window.localStorage) return { updatedAt: 0, items: [] };
	const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
	if (!raw) return { updatedAt: 0, items: [] };
	const parsed = safeJsonParse(raw, null);
	if (!parsed || typeof parsed !== 'object') return { updatedAt: 0, items: [] };
	const items = Array.isArray(parsed.items) ? parsed.items : [];
	const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
	return { updatedAt, items };
}

function writeCache(items) {
	if (typeof window === 'undefined' || !window.localStorage) return;
	try {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ updatedAt: Date.now(), items: items.slice(0, MAX_ITEMS) })
		);
	} catch {
		// ignore quota/security errors
	}
}

export function getMfdsCachedDrugs() {
	return readCache().items;
}

export function clearMfdsCache() {
	if (typeof window === 'undefined' || !window.localStorage) return;
	try {
		window.localStorage.removeItem(STORAGE_KEY);
		window.localStorage.removeItem(LEGACY_STORAGE_KEY);
	} catch {
		// ignore
	}
}

export function upsertMfdsDrugs(rawItems) {
	const incoming = Array.isArray(rawItems) ? rawItems : [];
	if (incoming.length === 0) return;

	const cache = readCache();
	const existing = Array.isArray(cache.items) ? cache.items : [];
	const map = new Map();

	for (const it of existing) {
		const name = String(it?.itemName ?? '').trim();
		const key = normalize(name);
		if (!key) continue;
		map.set(key, {
			itemName: name,
			entpName: String(it?.entpName ?? '').trim(),
			itemSeq: String(it?.itemSeq ?? '').trim(),
		});
	}

	for (const it of incoming) {
		const name = String(it?.itemName ?? '').trim();
		const key = normalize(name);
		if (!key) continue;
		map.delete(key);
		map.set(key, {
			itemName: name,
			entpName: String(it?.entpName ?? '').trim(),
			itemSeq: String(it?.itemSeq ?? '').trim(),
		});
	}

	// newest first
	const merged = Array.from(map.values()).reverse();
	writeCache(merged);
}
