import React, { useState } from 'react'; // ← useState import!

function DrugInput({ onAdd }) {
    const [inputValue, setInputValue] = useState('');

    const handleSubmit = () => {
        if (inputValue.trim()) {
            onAdd(inputValue);
            setInputValue(''); // 입력창 비우기
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
            <button type="button" onClick={handleSubmit}>추가하기</button>
        </div>
    );
}

export default DrugInput; // ← 이 줄 추가!