import { describe, it, expect } from 'vitest';
import { escapeHtml } from './exportUtils.js';

describe('escapeHtml', () => {
  it('escapes the five reserved HTML characters', () => {
    expect(escapeHtml('<script>alert("x")</script>&\'')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;'
    );
  });

  it('passes through plain text unchanged', () => {
    expect(escapeHtml('Acme Corp — LM358DR')).toBe('Acme Corp — LM358DR');
  });

  it('coerces null/undefined to an empty string instead of throwing', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('coerces numbers to strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});
