import React from 'react';

function List({ title, items, accent }) {
	if (!items || items.length === 0) return null;
	return (
		<div style={{ borderLeft: `6px solid ${accent}`, paddingLeft: 12, marginBottom: 12 }}>
			<div style={{ fontWeight: 800, marginBottom: 8 }}>{title}</div>
			<ul style={{ margin: 0, paddingLeft: 18 }}>
				{items.map((it, idx) => (
					// eslint-disable-next-line react/no-array-index-key
					<li key={idx} style={{ marginBottom: 6 }}>
						<strong>{it.title}</strong>: {it.message}
					</li>
				))}
			</ul>
		</div>
	);
}

export default function DangerCard({ interactions }) {
	const warnings = interactions?.warnings ?? [];
	const cautions = interactions?.cautions ?? [];
	if (warnings.length === 0 && cautions.length === 0) return null;

	return (
		<section style={{ marginTop: 16, background: '#FFF5F5', borderRadius: 12, padding: 16, border: '1px solid #FED7D7' }}>
			<h3 style={{ marginTop: 0 }}>안전 경고</h3>
			<List title="경고" items={warnings} accent="#E53E3E" />
			<List title="주의" items={cautions} accent="#DD6B20" />
		</section>
	);
}
