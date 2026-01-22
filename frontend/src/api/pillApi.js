import axios from 'axios';

const api = axios.create({
    baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000'
});

export const analyzePill = async (formData) => {
    const res = await api.post('/analyze', formData);
    return res.data;
};

export const checkSafety = async (pillList) => {
    const res = await api.post('/analyze-safety', { pill_list: pillList });
    return res.data;
};

export const searchMfdsDrugs = async (query, limit = 20) => {
    const q = String(query ?? '').trim();
    if (!q) return { status: 'ok', q: '', count: 0, items: [] };
    const res = await api.get('/mfds/search', { params: { q, limit } });
    return res.data;
};

export const checkDur = async (drugNames, options = {}) => {
    const items = Array.isArray(drugNames) ? drugNames : [];
    const asObjects = items.every((x) => x && typeof x === 'object' && !Array.isArray(x));
    const names = items
        .map((n) => (asObjects ? String(n?.name ?? '').trim() : String(n ?? '').trim()))
        .filter(Boolean);

    if (names.length < 2) return { status: 'ok', warnings: [], cautions: [], info: [] };

    const drugs = asObjects
        ? items.map((d) => ({
            name: String(d?.name ?? '').trim(),
            itemSeq: d?.itemSeq ?? null,
            productCode: d?.productCode ?? null,
        }))
        : null;

    const res = await api.post('/dur/check', {
        drug_names: names,
        drugs,
        ingredients_by_drug: options.ingredientsByDrug ?? undefined,
        scan_limit: options.scanLimit,
        per_page: options.perPage,
        max_pages: options.maxPages,
    });
    return res.data;
};