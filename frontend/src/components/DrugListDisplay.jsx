import React from 'react';

function DrugListDisplay({ drugs, onDelete }) {
    return (
        <div>
            {(drugs ?? []).map((drug, index) => (
                <div key={index} className="drug-item"> {/* 여기! */}
                    <span>{typeof drug === 'string' ? drug : drug?.label ?? drug?.name ?? String(drug)}</span>
                    <button onClick={() => onDelete(index)}>삭제</button>
                </div>
            ))}
        </div>
    );
}

export default DrugListDisplay; // ← 이 줄 추가!

