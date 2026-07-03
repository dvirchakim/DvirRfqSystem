import { describe, it, expect } from 'vitest';
import { computeMetric, groupBy, METRIC_KEYS } from './metrics.js';

const sample = [
  { status: 'new',        priority: 'high',   quantity: 100, targetPrice: 2,  customerName: 'Acme',   isObsolete: false },
  { status: 'completed',  priority: 'low',    quantity: 50,  targetPrice: 4,  customerName: 'Acme',   isObsolete: true  },
  { status: 'awaiting',   priority: 'high',   quantity: 10,  targetPrice: null, customerName: 'Globex', isObsolete: false },
  { status: 'distributed',priority: 'medium', quantity: 0,   targetPrice: 6,  customerName: 'Globex', isObsolete: false },
];

describe('computeMetric', () => {
  it('counts totals and status-derived metrics', () => {
    expect(computeMetric('total', sample).value).toBe(4);
    expect(computeMetric('completed', sample).value).toBe(1);
    expect(computeMetric('active', sample).value).toBe(3);
    expect(computeMetric('high_priority', sample).value).toBe(2);
    expect(computeMetric('obsolete', sample).value).toBe(1);
    expect(computeMetric('awaiting', sample).value).toBe(1);
    expect(computeMetric('distributed', sample).value).toBe(1);
  });

  it('sums quantities and counts distinct customers', () => {
    expect(computeMetric('total_quantity', sample).value).toBe(160);
    expect(computeMetric('customers', sample).value).toBe(2);
  });

  it('averages only positive target prices', () => {
    // (2 + 4 + 6) / 3 = 4  (null is excluded)
    expect(computeMetric('avg_target_price', sample).value).toBe(4);
  });

  it('returns a label for every declared metric key', () => {
    for (const key of METRIC_KEYS) {
      const m = computeMetric(key, sample);
      expect(typeof m.label).toBe('string');
      expect(m.label.length).toBeGreaterThan(0);
    }
  });

  it('falls back gracefully for an unknown metric', () => {
    expect(computeMetric('nonsense', sample).value).toBe('—');
  });
});

describe('groupBy', () => {
  it('groups by status and sorts descending by count', () => {
    const g = groupBy('status', sample);
    expect(g).toHaveLength(4);
    expect(g.every(x => x.value === 1)).toBe(true);
  });

  it('groups by customer', () => {
    const g = groupBy('customer', sample);
    const acme = g.find(x => x.label === 'Acme');
    expect(acme.value).toBe(2);
  });

  it('defaults unknown dimension to status', () => {
    expect(groupBy('bogus', sample)).toEqual(groupBy('status', sample));
  });
});
