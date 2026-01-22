import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:8000'
});

export const analyzePill = async (formData) => {
    const res = await api.post('/analyze', formData);
    return res.data;
};

export const checkSafety = async (pillList) => {
    const res = await api.post('/analyze-safety', { pill_list: pillList });
    return res.data;
};