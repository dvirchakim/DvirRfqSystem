import { groupBy } from './metrics.js';

// A horizontal bar chart the agent builds by naming a dimension to group RFQs by
// (status / priority / customer). Renders with plain divs — no charting lib, no
// agent-supplied markup.
export function BarChart({ rfqs = [], dimension = 'status', title, color = 'accent', limit = 8 }) {
  const accent = `var(--${color})`;
  const data = groupBy(dimension, rfqs).slice(0, Math.max(1, Math.min(20, limit)));
  const max = data.reduce((m, d) => Math.max(m, d.value), 0) || 1;

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 12 }}>
        📈 {title || `RFQs by ${dimension}`}
      </div>
      {data.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: 11, textAlign: 'center', padding: 20 }}>No data yet</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.map(d => (
            <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 90, fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.label}>
                {d.label}
              </div>
              <div style={{ flex: 1, height: 16, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${Math.round((d.value / max) * 100)}%`,
                  background: accent, borderRadius: 4, transition: 'width 0.4s ease',
                  minWidth: d.value > 0 ? 2 : 0,
                }} />
              </div>
              <div style={{ width: 32, fontSize: 11, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>
                {d.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
