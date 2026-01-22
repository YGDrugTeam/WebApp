import React, { useMemo, useState } from 'react';
import { searchMfdsDrugs } from '../api/pillApi';

function DrugInput({ onAdd }) {
    const [inputValue, setInputValue] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [mfdsResults, setMfdsResults] = useState([]);

    const handleSubmit = () => {
        if (inputValue.trim()) {
            onAdd(inputValue);
            setInputValue(''); // 입력창 비우기
        }
    };

    const canSearch = useMemo(() => String(inputValue ?? '').trim().length >= 2, [inputValue]);

    const handleMfdsSearch = async () => {
        const q = String(inputValue ?? '').trim();
        if (q.length < 2) return;
        setIsSearching(true);
        setSearchError('');
        try {
            const data = await searchMfdsDrugs(q, 20);
            if (data?.ok === false) {
                setMfdsResults([]);
                setSearchError(data?.detail || data?.error || 'MFDS 검색 실패');
                return;
            }
            const items = Array.isArray(data?.items) ? data.items : [];
            setMfdsResults(items);
            if (items.length === 0) setSearchError('검색 결과가 없습니다.');
        } catch (e) {
            setMfdsResults([]);
            setSearchError('MFDS 검색 중 오류가 발생했습니다. 백엔드가 실행 중인지 확인해 주세요.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleSubmit();
        }
    };

    return (
        <div>
            <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="약 이름을 입력하세요"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={handleSubmit}>추가하기</button>
                <button type="button" onClick={handleMfdsSearch} disabled={!canSearch || isSearching}>
                    {isSearching ? '검색 중…' : 'MFDS 검색'}
                </button>
            </div>

            {searchError && (
                <div style={{ marginTop: 8, color: '#B83280', fontSize: 13 }}>
                    {searchError}
                </div>
            )}

            {mfdsResults.length > 0 && (
                <div style={{ marginTop: 10, padding: 10, border: '1px solid #E2E8F0', borderRadius: 10, background: 'white' }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>MFDS 검색 결과</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                        {mfdsResults.slice(0, 10).map((item) => {
                            const name = String(item?.itemName ?? '').trim();
                            const entp = String(item?.entpName ?? '').trim();
                            const seq = String(item?.itemSeq ?? '').trim();
                            if (!name) return null;
                            return (
                                <button
                                    key={`${seq || name}-${entp}`}
                                    type="button"
                                    onClick={() => onAdd(name)}
                                    style={{
                                        textAlign: 'left',
                                        padding: '10px 12px',
                                        borderRadius: 10,
                                        border: '1px solid #EDF2F7',
                                        background: '#FAFAFA',
                                        cursor: 'pointer',
                                    }}
                                    title={seq ? `품목기준코드: ${seq}` : ''}
                                >
                                    <div style={{ fontWeight: 900 }}>{name}</div>
                                    {entp && <div style={{ fontSize: 12, color: '#4A5568' }}>{entp}</div>}
                                </button>
                            );
                        })}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: '#718096' }}>
                        더 많은 결과가 필요하면 검색어를 더 구체적으로 입력해 주세요.
                    </div>
                </div>
            )}
        </div>
    );
}

export default DrugInput; // ← 이 줄 추가!