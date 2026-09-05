import { describe, expect, it } from 'vitest';
import { LOCALES, TEMPLATES, templatesFor } from './templates';

describe('CheckoutRecovery templates', () => {
  it('defines all supported locales and falls back to en-IN', () => {
    for (const locale of LOCALES) {
      const selected = templatesFor(locale);
      expect(selected.retry_link.name).toBe('aegis_checkout_retry_link_v1');
      expect(selected.retry_link.language).toBe(locale.replace('-', '_'));
    }
    expect(templatesFor('xx-XX')).toBe(TEMPLATES['en-IN']);
    expect(templatesFor(null)).toBe(TEMPLATES['en-IN']);
  });

  it('uses Hindi customer-facing body strings for hi-IN', () => {
    const body = TEMPLATES['hi-IN'].retry_link.bodyParams({ amount: '₹1,499.00' }).join(' ');
    expect(body).toMatch(/[\u0900-\u097f]/u);
    expect(body).toContain('₹1,499.00');
  });

  it('keeps URL button parameters unchanged', () => {
    const link = 'https://rzp.io/l/aegis-ABCDEFGH';
    expect(TEMPLATES['en-IN'].retry_link.buttonUrl(link)).toBe(link);
  });
});

