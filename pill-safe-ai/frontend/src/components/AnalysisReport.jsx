import React from 'react';
import DangerCard from './DangerCard';

function scoreLabel(score) {
	if (score >= 0.9) return '매우 높음';
	if (score >= 0.75) return '높음';
	if (score >= 0.6) return '보통';
	return '낮음';
}

export default function AnalysisReport({ drugItems, interactionResult }) {
	const items = Array.isArray(drugItems) ? drugItems : [];
	const warnings = interactionResult?.warnings ?? [];
	const hasDurAge = warnings.some((w) => w.kind === 'dur-age');

	if (items.length === 0) {
		return (
			<p className="muted">약을 등록하면 분석이 시작됩니다.</p>
		);
	}

	return (
		<div className="report">
			<div className="report__section">
				<div className="report__kpi">
					<div className="kpi__label">등록된 약</div>
					<div className="kpi__value">{items.length}개</div>
				</div>
			</div>

			<div className="report__section">
				<h3 className="section-title">인식/매칭 결과</h3>
				<div className="stack">
					{items.map((item) => {
						const best = item.match?.best;
						const matchedDrug = best?.drug ?? null;
						const score = best?.score ?? 0;

						return (
							<div key={item.id} className="card">
								<div className="card__row">
									<div>
										<div className="card__title">
											{matchedDrug ? matchedDrug.brandNameKo : item.rawName}
										</div>
										<div className="card__subtitle">
											입력/인식: <span className="mono">{item.rawName}</span>
										</div>
									</div>
									<div className="pill">
										{matchedDrug ? `매칭 ${scoreLabel(score)} (${Math.round(score * 100)}%)` : 'DB 미매칭'}
									</div>
								</div>

								{matchedDrug ? (
									<div className="card__body">
										<div className="kv">
											<div className="kv__k">용도</div>
											<div className="kv__v">{matchedDrug.usage}</div>
										</div>
										<div className="kv">
											<div className="kv__k">성분</div>
											<div className="kv__v">{(matchedDrug.ingredients ?? []).join(', ')}</div>
										</div>
										{(matchedDrug.notes ?? []).length > 0 ? (
											<ul className="bullets">
												{matchedDrug.notes.map((n) => (
													<li key={n}>{n}</li>
												))}
											</ul>
										) : null}
									</div>
								) : (
									<div className="card__body muted">
										약 DB에 없는 이름입니다. 정확한 제품명으로 다시 입력하거나 DB를 확장해 주세요.
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>

			<div className="report__section">
				<h3 className="section-title">병용 금기/주의</h3>
				{hasDurAge ? (
					<div className="callout callout--info" style={{ marginBottom: 10 }}>
						<div className="callout__title">DUR(특정 연령대 금기) 경고 포함</div>
						<div className="callout__body">
							이 섹션에는 DUR 연령 금기 데이터 기반 경고가 포함될 수 있습니다. 출처 예시: 공공데이터포털의
							{' '}
							<a href="https://www.data.go.kr/data/15127983/fileData.do" target="_blank" rel="noreferrer">DUR 의약품 목록</a>,
							{' '}
							<a href="https://www.data.go.kr/data/15089531/fileData.do" target="_blank" rel="noreferrer">연령금기</a>.
						</div>
					</div>
				) : null}
				{warnings.length === 0 ? (
					<div className="card muted">현재 데이터 기준으로 큰 경고가 없습니다.</div>
				) : (
					<div className="stack">
						{warnings.map((w, idx) => (
							<DangerCard
								key={`${w.kind}-${idx}`}
								title={w.title}
								severity={w.severity}
								meta={w.relatedIngredients?.length ? `관련 성분: ${w.relatedIngredients.join(', ')}` : null}
							>
								{w.message}
							</DangerCard>
						))}
					</div>
				)}

				{interactionResult?.disclaimer ? (
					<div className="disclaimer">{interactionResult.disclaimer}</div>
				) : null}
			</div>
		</div>
	);
}
