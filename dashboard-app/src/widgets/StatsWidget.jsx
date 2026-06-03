export function StatsWidget({ rfqs = [], title = 'RFQ Pipeline', highlight = false }) {
  const total     = rfqs.length;
  const byStatus  = rfqs.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const highPri   = rfqs.filter(r => r.priority === 'high').length;
  const completed = byStatus.completed || 0;
  const active    = total - completed;

  const card = (label, value, color) => (
    <div key={label} style={{
      background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px',
      borderLeft: `3px solid ${color}`, flex: '1 1 100px',
    }}>
      <div style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 12, padding: 16,
      border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
      boxShadow: highlight ? '0 0 12px var(--accent)20' : 'none',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>📊 {title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {card('Total RFQs',  total,     'var(--text)')}
        {card('Active',      active,    'var(--accent)')}
        {card('Completed',   completed, 'var(--green)')}
        {card('High Priority', highPri, 'var(--red)')}
      </div>
      {Object.keys(byStatus).length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(byStatus).map(([s, n]) => (
            <span key={s} style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 20,
              background: 'var(--surface3)', color: 'var(--text2)',
              border: '1px solid var(--border)',
            }}>{s}: {n}</span>
          ))}
        </div>
      )}
    </div>
  );
}
