import { useState } from 'react';

const STATUS_COLOR = {
  new: '#64748b', processing: '#fbbf24', parsed: '#38bdf8',
  ready: '#a78bfa', distributed: '#f472b6', awaiting: '#fb923c',
  completed: '#34d399',
};

export function RFQTable({ rfqs = [], defaultFilter = '', title = 'RFQ Table', statusFilter = '', limit = 20 }) {
  const [filter, setFilter] = useState(defaultFilter);
  const cap = Math.max(1, Math.min(100, limit));

  const rows = rfqs
    .filter(r => r.partNumber)
    .filter(r => !statusFilter || r.status === statusFilter)
    .filter(r =>
      !filter ||
      r.status === filter ||
      r.customerName?.toLowerCase().includes(filter.toLowerCase()) ||
      r.partNumber?.toLowerCase().includes(filter.toLowerCase())
    )
    .slice(0, cap);

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>📋 {title}</span>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter…"
          style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 11,
            background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text)', outline: 'none', width: 140,
          }}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, direction: 'ltr' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)', color: 'var(--text3)', fontSize: 9, textTransform: 'uppercase' }}>
              {['Customer', 'Part #', 'Qty', 'Status', 'Priority'].map(h => (
                <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text3)' }}>No RFQs</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '5px 8px', color: 'var(--text2)' }}>{r.customerName || '—'}</td>
                <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: 'var(--accent)' }}>{r.partNumber}</td>
                <td style={{ padding: '5px 8px', color: 'var(--text2)' }}>{r.quantity?.toLocaleString() || '—'}</td>
                <td style={{ padding: '5px 8px' }}>
                  <span style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 4,
                    background: `${STATUS_COLOR[r.status] || '#64748b'}20`,
                    color: STATUS_COLOR[r.status] || '#64748b',
                    border: `1px solid ${STATUS_COLOR[r.status] || '#64748b'}40`,
                  }}>{r.status}</span>
                </td>
                <td style={{ padding: '5px 8px', color: r.priority === 'high' ? 'var(--red)' : r.priority === 'medium' ? 'var(--amber)' : 'var(--green)', fontSize: 10, fontWeight: 600 }}>
                  {r.priority}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
