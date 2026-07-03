// The agent's "add a function/button" primitive. The agent supplies a list of
// buttons, each naming an action from a fixed allow-list (ACTION_LABELS). The
// action string is dispatched through onAction to the host, which decides what
// each one does — the agent can never wire a button to arbitrary code, only to
// a capability the app has explicitly exposed.

export const ACTION_LABELS = {
  connect_gmail:  '📬 Connect Gmail',
  connect_outlook:'📮 Connect Outlook',
  manual_mode:    '⚡ Manual Mode',
  send_suppliers: '📤 Send to Suppliers',
  export_excel:   '📊 Export Excel',
  export_pdf:     '🖨 Export PDF',
  go_dashboard:   '📋 Open Dashboard',
  go_inbox:       '📥 Open Inbox',
  go_settings:    '⚙️ Open Settings',
  refresh:        '🔄 Refresh',
};

export const ACTION_KEYS = Object.keys(ACTION_LABELS);

export function ActionButtons({ onAction, title = 'Actions', actions = [], color = 'amber' }) {
  const list = (actions.length ? actions : ['go_dashboard']).filter(a => ACTION_KEYS.includes(a));
  const accent = `var(--${color})`;

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '12px 16px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 10 }}>⚡ {title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {list.map(action => (
          <button
            key={action}
            onClick={() => onAction?.(action)}
            style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', border: `1px solid ${accent}40`,
              background: `${accent}15`, color: accent, transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${accent}30`; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${accent}15`; }}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>
    </div>
  );
}
