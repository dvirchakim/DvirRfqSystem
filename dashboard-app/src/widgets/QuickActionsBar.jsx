export function QuickActionsBar({ onAction }) {
  const btn = (label, action, color = 'var(--accent)') => (
    <button
      key={action}
      onClick={() => onAction?.(action)}
      style={{
        padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700,
        cursor: 'pointer', border: `1px solid ${color}40`,
        background: `${color}15`, color, transition: 'background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = `${color}30`; }}
      onMouseLeave={e => { e.currentTarget.style.background = `${color}15`; }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '12px 16px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 10 }}>⚡ Quick Actions</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {btn('📬 Connect Gmail',    'connect_gmail',   'var(--accent)')}
        {btn('⚡ Manual Mode',      'manual_mode',     'var(--amber)')}
        {btn('📤 Send to Suppliers','send_suppliers',  'var(--pink)')}
        {btn('📊 Export CSV',       'export_csv',      'var(--green)')}
      </div>
    </div>
  );
}
