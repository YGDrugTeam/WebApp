import React from 'react';

export default function PatientInfo({ ageYearsInput, onAgeYearsInputChange }) {
	const setPreset = (age) => {
		onAgeYearsInputChange(String(age));
	};

	return (
		<div className="card">
			<div className="card__row">
				<div>
					<div className="card__title">사용자 정보</div>
					<div className="card__subtitle">연령을 입력하면 DUR(특정 연령대 금기) 경고를 계산합니다.</div>
				</div>
			</div>

			<div className="card__body">
				<div className="kv">
					<div className="kv__k">나이(만)</div>
					<div className="kv__v" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
						<input
							type="number"
							min={0}
							max={120}
							value={ageYearsInput}
							onChange={(e) => onAgeYearsInputChange(e.target.value)}
							placeholder="예: 8"
							style={{ width: 120 }}
						/>
						<button className="btn btn-secondary" type="button" onClick={() => onAgeYearsInputChange('')}>초기화</button>
					</div>
				</div>

				<div className="segmented" style={{ marginTop: 10 }}>
					<button type="button" className="segmented__btn" onClick={() => setPreset(1)}>영유아</button>
					<button type="button" className="segmented__btn" onClick={() => setPreset(6)}>소아</button>
					<button type="button" className="segmented__btn" onClick={() => setPreset(15)}>청소년</button>
					<button type="button" className="segmented__btn" onClick={() => setPreset(30)}>성인</button>
					<button type="button" className="segmented__btn" onClick={() => setPreset(70)}>노인</button>
				</div>

				<div className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
					입력값은 참고용이며, 금기/주의는 제품·용량·진단에 따라 달라질 수 있습니다.
				</div>
			</div>
		</div>
	);
}
