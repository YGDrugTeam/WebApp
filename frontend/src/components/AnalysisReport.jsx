import React from 'react';

function renderMultiline(text) {
	const lines = String(text ?? '').split(/\r?\n/);
	return lines.map((line, idx) => (
		// eslint-disable-next-line react/no-array-index-key
		<div key={idx}>{line || <span>&nbsp;</span>}</div>
	));
}

export default function AnalysisReport({ aiReport, interactions }) {
	const hasAi = Boolean(String(aiReport ?? '').trim());
	const hasInteractions = Boolean(interactions) && (
		(interactions.warnings?.length ?? 0) + (interactions.cautions?.length ?? 0) + (interactions.info?.length ?? 0) > 0
	);

	if (!hasAi && !hasInteractions) return null;

	const countWarnings = interactions?.warnings?.length ?? 0;
	const countCautions = interactions?.cautions?.length ?? 0;
	const countInfo = interactions?.info?.length ?? 0;

	return (
		<section className="card" style={{ marginTop: 16 }}>
			<div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
				<h3 style={{ marginTop: 0, marginBottom: 0 }}>종합 안전 리포트</h3>
				<div style={{ fontSize: 12, color: '#718096' }}>상호작용 + AI 요약</div>
			</div>

			{hasInteractions && (
				<div style={{ marginTop: 12, padding: 12, border: '1px solid #EDF2F7', borderRadius: 12, background: '#FAFAFA' }}>
					<div style={{ fontWeight: 900, marginBottom: 8 }}>요약</div>
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
						<span style={{ fontSize: 12, fontWeight: 900, padding: '4px 10px', borderRadius: 999, background: '#FED7D7', border: '1px solid #FEB2B2', color: '#742A2A' }}>
							경고 {countWarnings}
						</span>
						<span style={{ fontSize: 12, fontWeight: 900, padding: '4px 10px', borderRadius: 999, background: '#FEFCBF', border: '1px solid #F6E05E', color: '#744210' }}>
							주의 {countCautions}
						</span>
						<span style={{ fontSize: 12, fontWeight: 900, padding: '4px 10px', borderRadius: 999, background: '#EDF2F7', border: '1px solid #E2E8F0', color: '#2D3748' }}>
							참고 {countInfo}
						</span>
					</div>
				</div>
			)}

			{hasAi && (
				<div style={{ marginTop: 12, padding: 12, border: '1px solid #EDF2F7', borderRadius: 12, background: '#F7FAFC', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
					<div style={{ fontWeight: 900, marginBottom: 8 }}>AI 요약</div>
					{renderMultiline(aiReport)}
				</div>
			)}
		</section>
	);
}
