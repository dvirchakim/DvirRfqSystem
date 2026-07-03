import { describe, it, expect } from 'vitest';
import { buildSupplierEmail, buildFollowUpEmail } from './emailTemplates.js';

// These fields originate from LLM-parsed inbound email content, which is attacker-influenceable.
// A malicious RFQ email could try to inject HTML/script into any of these — regression guard
// for the XSS fix in buildSupplierEmail / buildFollowUpEmail.
describe('buildSupplierEmail', () => {
  it('HTML-escapes attacker-controlled RFQ fields', () => {
    const html = buildSupplierEmail({
      partNumber: '<img src=x onerror=alert(1)>',
      quantity: 100,
      deliveryDate: '<script>alert(2)</script>',
      acceptsAlternatives: '<b>Yes</b>',
      specialRequirements: '"><script>alert(3)</script>',
      isObsolete: false,
    });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).not.toContain('<script>alert(3)</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders normal fields without escaping artifacts', () => {
    const html = buildSupplierEmail({
      partNumber: 'LM358DR',
      quantity: 1000,
      deliveryDate: '15/06/2026',
      targetPrice: 0.85,
      acceptsAlternatives: 'Yes',
    });
    expect(html).toContain('LM358DR');
    expect(html).toContain('1,000 pcs');
    expect(html).toContain('$0.85 / unit');
  });
});

describe('buildFollowUpEmail', () => {
  it('HTML-escapes part number and customer name for each missing-date RFQ', () => {
    const html = buildFollowUpEmail([
      { partNumber: '<script>alert(1)</script>', customerName: 'Acme & Co' },
    ]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Acme &amp; Co');
  });
});
