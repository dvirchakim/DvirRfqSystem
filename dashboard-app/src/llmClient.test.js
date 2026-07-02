import { describe, it, expect } from 'vitest';
import { scoreSupplierResponse, DEFAULT_FX_TO_USD } from './llmClient.js';

describe('scoreSupplierResponse', () => {
  it('awards full price score when quote beats target by 20%+', () => {
    const score = scoreSupplierResponse(
      { quotedPrice: 0.7, leadTimeDays: 0, availableQty: 100 },
      { targetPrice: 1.0, quantity: 100 }
    );
    expect(score).toBe(100); // 40 price + 40 lead time (in stock) + 20 availability
  });

  it('scores zero price points when quote exceeds target', () => {
    const score = scoreSupplierResponse(
      { quotedPrice: 1.5, leadTimeDays: 0, availableQty: 100 },
      { targetPrice: 1.0, quantity: 100 }
    );
    expect(score).toBe(60); // 0 price + 40 lead time + 20 availability
  });

  it('gives a neutral price score when there is no target price to compare', () => {
    const score = scoreSupplierResponse(
      { quotedPrice: 5, leadTimeDays: 0, availableQty: 100 },
      { targetPrice: null, quantity: 100 }
    );
    expect(score).toBe(80); // 20 neutral price + 40 lead time + 20 availability
  });

  it('converts non-USD quotes to USD before scoring against a USD target', () => {
    // 1 EUR = 1.08 USD by default, so a 1 EUR quote against a 1.20 USD target
    // is really a ~10% saving, not the ~17% a naive same-scale comparison would imply.
    const eurScore = scoreSupplierResponse(
      { quotedPrice: 1, currency: 'EUR', leadTimeDays: 0 },
      { targetPrice: 1.2 }
    );
    const usdEquivalentScore = scoreSupplierResponse(
      { quotedPrice: 1.08, currency: 'USD', leadTimeDays: 0 },
      { targetPrice: 1.2 }
    );
    expect(eurScore).toBe(usdEquivalentScore);
  });

  it('honors a custom fxRates override over the default table', () => {
    const customRates = { ...DEFAULT_FX_TO_USD, EUR: 2 };
    const score = scoreSupplierResponse(
      { quotedPrice: 1, currency: 'EUR', leadTimeDays: 0 },
      { targetPrice: 1.2 },
      customRates
    );
    // 1 EUR * 2 = $2 quoted against a $1.20 target => well over target => 0 price points
    expect(score).toBe(40); // 0 price + 40 lead time (in stock)
  });

  it('gives full lead-time score for in-stock and scales down for longer lead times', () => {
    expect(scoreSupplierResponse({ leadTimeDays: 0 }, {})).toBeGreaterThan(
      scoreSupplierResponse({ leadTimeDays: 120 }, {})
    );
  });

  it('caps the score at 100', () => {
    const score = scoreSupplierResponse(
      { quotedPrice: 0.1, leadTimeDays: 0, availableQty: 10000 },
      { targetPrice: 1.0, quantity: 10 }
    );
    expect(score).toBeLessThanOrEqual(100);
  });
});
