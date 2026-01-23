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

	return (
		<section style={{ marginTop: 20, background: 'white', borderRadius: 12, padding: 16, border: '1px solid #E2E8F0' }}>
			<h3 style={{ marginTop: 0 }}>AI 약사 리포트</h3>

			{hasInteractions && (
				<div style={{ marginBottom: 16 }}>
					<strong>요약</strong>
					<ul>
						<li>경고: {interactions.warnings?.length ?? 0}건</li>
						<li>주의: {interactions.cautions?.length ?? 0}건</li>
						<li>참고: {interactions.info?.length ?? 0}건</li>
					</ul>
				</div>
			)}

			{hasAi && (
				<div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
					{renderMultiline(aiReport)}
				</div>
			)}
		</section>
	);
}
