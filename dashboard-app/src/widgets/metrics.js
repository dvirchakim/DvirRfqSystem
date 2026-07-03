// Named metric vocabulary the agent can reference by string key. Keeping this a
// fixed, data-driven registry (rather than letting the agent supply an expression)
// is deliberate: the agent reshapes the UI without ever running arbitrary code.

export const METRIC_DEFS = {
  total:         { label: 'Total RFQs',      compute: r => r.length },
  active:        { label: 'Active',          compute: r => r.filter(x => x.status !== 'completed').length },
  completed:     { label: 'Completed',       compute: r => r.filter(x => x.status === 'completed').length },
  high_priority: { label: 'High Priority',   compute: r => r.filter(x => x.priority === 'high').length },
  obsolete:      { label: 'Obsolete Parts',  compute: r => r.filter(x => x.isObsolete).length },
  awaiting:      { label: 'Awaiting Replies',compute: r => r.filter(x => x.status === 'awaiting').length },
  distributed:   { label: 'Distributed',     compute: r => r.filter(x => x.status === 'distributed').length },
  ready:         { label: 'Ready to Send',   compute: r => r.filter(x => x.status === 'ready').length },
  total_quantity:{ label: 'Total Units',     compute: r => r.reduce((s, x) => s + (Number(x.quantity) || 0), 0) },
  customers:     { label: 'Distinct Customers', compute: r => new Set(r.map(x => x.customerName).filter(Boolean)).size },
  avg_target_price: {
    label: 'Avg Target ($)',
    compute: r => {
      const vals = r.map(x => Number(x.targetPrice)).filter(v => Number.isFinite(v) && v > 0);
      return vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2) : 0;
    },
  },
};

export const METRIC_KEYS = Object.keys(METRIC_DEFS);

export function computeMetric(key, rfqs = []) {
  const def = METRIC_DEFS[key];
  if (!def) return { label: key, value: '—' };
  return { label: def.label, value: def.compute(rfqs) };
}

// Group RFQs into { label, value } buckets along a fixed set of dimensions —
// powers the BarChart widget.
export const GROUP_DIMS = {
  status:   r => r.status   || 'unknown',
  priority: r => r.priority || 'unknown',
  customer: r => r.customerName || '(Unknown)',
};

export function groupBy(dim, rfqs = []) {
  const fn = GROUP_DIMS[dim] || GROUP_DIMS.status;
  const counts = {};
  for (const r of rfqs) {
    const k = fn(r);
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}
