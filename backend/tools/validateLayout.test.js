import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout } from './validateLayout.js';

test('accepts a minimal valid layout and defaults the theme', () => {
  const out = validateLayout({ components: [{ type: 'StatsWidget' }] });
  assert.equal(out.theme, 'dark');
  assert.deepEqual(out.components, [{ type: 'StatsWidget', props: {} }]);
});

test('rejects a non-object payload', () => {
  assert.throws(() => validateLayout(null), /must be a JSON object/);
  assert.throws(() => validateLayout([]), /must be a JSON object/);
});

test('rejects an unknown theme', () => {
  assert.throws(() => validateLayout({ theme: 'neon', components: [] }), /Unknown theme/);
});

test('rejects an unknown component type', () => {
  assert.throws(
    () => validateLayout({ components: [{ type: 'EvilWidget' }] }),
    /Unknown component type/
  );
});

test('rejects non-array components', () => {
  assert.throws(() => validateLayout({ components: {} }), /components must be an array/);
});

test('caps the number of components', () => {
  const many = Array.from({ length: 25 }, () => ({ type: 'StatsWidget' }));
  assert.throws(() => validateLayout({ components: many }), /Too many components/);
});

test('drops unknown props and keeps whitelisted ones', () => {
  const out = validateLayout({
    components: [{ type: 'MetricCard', props: { metric: 'high_priority', label: 'Hot', evil: 'x' } }],
  });
  assert.deepEqual(out.components[0].props, { metric: 'high_priority', label: 'Hot' });
});

test('clamps integer props to their declared range', () => {
  const out = validateLayout({ components: [{ type: 'BarChart', props: { limit: 9999 } }] });
  assert.equal(out.components[0].props.limit, 20);
  const out2 = validateLayout({ components: [{ type: 'BarChart', props: { limit: -5 } }] });
  assert.equal(out2.components[0].props.limit, 1);
});

test('drops invalid enum values', () => {
  const out = validateLayout({ components: [{ type: 'MetricCard', props: { metric: 'DROP TABLE', color: 'plaid' } }] });
  assert.deepEqual(out.components[0].props, {}); // both invalid → dropped
});

test('filters an action list down to allowed actions and dedupes', () => {
  const out = validateLayout({
    components: [{ type: 'ActionButtons', props: { actions: ['export_excel', 'rm_rf', 'export_excel', 'go_inbox'] } }],
  });
  assert.deepEqual(out.components[0].props.actions, ['export_excel', 'go_inbox']);
});

test('truncates over-long strings to the widget maxLen', () => {
  const longBody = 'x'.repeat(5000);
  const out = validateLayout({ components: [{ type: 'MarkdownCard', props: { body: longBody } }] });
  assert.equal(out.components[0].props.body.length, 1200);
});

test('rejects props that are not a plain object', () => {
  assert.throws(
    () => validateLayout({ components: [{ type: 'StatsWidget', props: [1, 2] }] }),
    /props must be a plain object/
  );
});
