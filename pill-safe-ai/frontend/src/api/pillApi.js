import axios from 'axios';

const api = axios.create({
    baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000'
});

export const analyzePill = async (formData, options = {}) => {
    const params = {};
    const mode = options?.mode;
    const debug = options?.debug;
    if (typeof mode === 'string' && mode.trim()) params.mode = mode.trim();
    if (debug === 1 || debug === true) params.debug = 1;
    const res = await api.post('/analyze', formData, { params });
    return res.data;
};

export const checkSafety = async (pillList) => {
    const res = await api.post('/analyze-safety', { pill_list: pillList });
    return res.data;
};

export const searchMfdsDrugs = async (query, limit = 20, options = {}) => {
    const q = String(query ?? '').trim();
    if (!q) return { status: 'ok', q: '', count: 0, items: [] };
    const scanPages = options?.scanPages;
    const params = { q, limit };
    if (typeof scanPages === 'number' && Number.isFinite(scanPages) && scanPages > 0) {
        params.scan_pages = scanPages;
    }
    const res = await api.get('/mfds/search', { params });
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

export const ragQuery = async (query, options = {}) => {
    const q = String(query ?? '').trim();
    if (!q) return { ok: false, error: 'rag_query_missing', detail: 'query is required' };
    const k = typeof options?.k === 'number' ? options.k : 5;
    const payload = { query: q, k };
    if (Array.isArray(options?.drugNames) && options.drugNames.length > 0) {
        payload.drug_names = options.drugNames;
    }
    if (typeof options?.useTools === 'boolean') {
        payload.use_tools = options.useTools;
    }
    if (typeof options?.mfdsScanPages === 'number' && Number.isFinite(options.mfdsScanPages)) {
        payload.mfds_scan_pages = options.mfdsScanPages;
    }
    if (typeof options?.ageGroup === 'string' && options.ageGroup.trim()) {
        payload.age_group = options.ageGroup.trim();
    }
    const ageYearsRaw = options?.ageYears;
    if (ageYearsRaw !== undefined && ageYearsRaw !== null && String(ageYearsRaw).trim() !== '') {
        const n = Number(ageYearsRaw);
        if (Number.isFinite(n)) payload.age_years = Math.max(0, Math.floor(n));
    }
    if (Array.isArray(options?.profileTags) && options.profileTags.length > 0) {
        payload.profile_tags = options.profileTags
            .map((t) => String(t ?? '').trim())
            .filter(Boolean)
            .slice(0, 6);
    }
    const res = await api.post('/rag/query', payload);
    return res.data;
};

export const ragIndex = async (options = {}) => {
    const save = options?.save !== false;
    const res = await api.post('/rag/index', { save });
    return res.data;
};

export const ragPrompt = async () => {
    const res = await api.get('/rag/prompt');
    return res.data;
};