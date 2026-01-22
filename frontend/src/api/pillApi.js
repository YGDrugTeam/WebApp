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