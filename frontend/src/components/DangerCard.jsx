import React from 'react';

function getClassNameBySeverity(severity) {
	switch (severity) {
		case 'high':
			return 'danger-card danger-high';
		case 'medium':
			return 'danger-card danger-medium';
		case 'low':
			return 'danger-card danger-low';
		default:
			return 'danger-card';
	}
}

export default function DangerCard({ title, severity = 'low', children, meta }) {
	return (
		<div className={getClassNameBySeverity(severity)}>
			<div className="danger-card__header">
				<div className="danger-card__title">{title}</div>
				<div className="danger-card__badge">{severity.toUpperCase()}</div>
			</div>
			{meta ? <div className="danger-card__meta">{meta}</div> : null}
			<div className="danger-card__body">{children}</div>
		</div>
	);
}
