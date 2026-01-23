import React from 'react';
import { formatDrugDisplay } from '../utils/drugMatcher';

function DrugListDisplay({ drugs, onDelete }) {
    return (
        <div>
            {drugs.map((drug) => (
                <div key={drug.id} className="drug-item">
                    <div className="drug-item__text">
                        <span className="drug-item__name">{formatDrugDisplay(drug)}</span>
                        <span className="drug-item__sub">입력/인식: {drug.rawName}</span>
                    </div>
                    <button onClick={() => onDelete(drug.id)}>삭제</button>
                </div>
            ))}
        </div>
    );
}

export default DrugListDisplay; // ← 이 줄 추가!

