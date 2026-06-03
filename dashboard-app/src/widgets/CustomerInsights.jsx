export function CustomerInsights({ rfqs = [] }) {
  const byClient = {};
  for (const r of rfqs) {
    const k = r.customerName || '(Unknown)';
    if (!byClient[k]) byClient[k] = { total: 0, completed: 0, high: 0 };
    byClient[k].total++;
    if (r.status === 'completed') byClient[k].completed++;
    if (r.priority === 'high')    byClient[k].high++;
  }

  const sorted = Object.entries(byClient).sort((a, b) => b[1].total - a[1].total);

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 12 }}>👥 Customer Insights</div>
      {sorted.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: 11, textAlign: 'center', padding: 20 }}>No data yet</div>
      ) : sorted.map(([name, stats]) => {
        const pct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
        return (
          <div key={name} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{name}</span>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                {stats.total} RFQs · {stats.completed} done
                {stats.high > 0 && <span style={{ color: 'var(--red)', marginLeft: 6 }}>🔴 {stats.high} high</span>}
              </span>
            </div>
            <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: pct === 100 ? 'var(--green)' : 'var(--accent)',
                borderRadius: 3, transition: 'width 0.4s ease',
              }} />
            </div>
            <div style={{ fontSize: 9, color: 'var(--text3)', textAlign: 'right', marginTop: 2 }}>{pct}% complete</div>
          </div>
        );
      })}
    </div>
  );
}
