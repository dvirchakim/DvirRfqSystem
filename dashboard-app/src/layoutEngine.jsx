import { useEffect } from 'react';
import { StatsWidget }      from './widgets/StatsWidget.jsx';
import { RFQTable }         from './widgets/RFQTable.jsx';
import { QuickActionsBar }  from './widgets/QuickActionsBar.jsx';
import { CustomerInsights } from './widgets/CustomerInsights.jsx';

const REGISTRY = { StatsWidget, RFQTable, QuickActionsBar, CustomerInsights };

export const DEFAULT_LAYOUT = {
  theme: 'dark',
  components: [
    { type: 'StatsWidget',      props: {} },
    { type: 'RFQTable',         props: {} },
    { type: 'QuickActionsBar',  props: {} },
    { type: 'CustomerInsights', props: {} },
  ],
};

/**
 * Renders the current agent-controlled layout.
 * Applies the theme to document.body via data-theme attribute.
 */
export function LayoutEngine({ layout = DEFAULT_LAYOUT, rfqs = [], onAction }) {
  useEffect(() => {
    const theme = layout?.theme || 'dark';
    document.body.setAttribute('data-theme', theme);
    return () => document.body.removeAttribute('data-theme');
  }, [layout?.theme]);

  const components = layout?.components ?? [];
  if (!components.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {components.map((comp, i) => {
        const Comp = REGISTRY[comp.type];
        if (!Comp) return (
          <div key={i} style={{ padding: 10, fontSize: 11, color: 'var(--red)', background: 'var(--surface)', borderRadius: 8 }}>
            Unknown component: {comp.type}
          </div>
        );
        return (
          <div key={`${comp.type}-${i}`} style={{ animation: 'slideIn 0.25s ease' }}>
            <Comp rfqs={rfqs} onAction={onAction} {...(comp.props || {})} />
          </div>
        );
      })}
    </div>
  );
}
