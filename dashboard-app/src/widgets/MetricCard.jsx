import { computeMetric } from './metrics.js';

// A single big-number KPI the agent composes by choosing a metric key and,
// optionally, its own label and accent color. All agent-supplied strings are
// rendered as React children (auto-escaped) — never as HTML.
export function MetricCard({ rfqs = [], metric = 'total', label, color = 'accent' }) {
  const { label: defLabel, value } = computeMetric(metric, rfqs);
  const accent = `var(--${color})`;
  const display = typeof value === 'number' ? value.toLocaleString() : value;

  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 12, padding: 20,
      border: '1px solid var(--border)', borderLeft: `4px solid ${accent}`,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label || defLabel}
      </div>
      <div style={{ fontSize: 34, fontWeight: 800, color: accent, marginTop: 6, lineHeight: 1 }}>
        {display}
      </div>
    </div>
  );
}
