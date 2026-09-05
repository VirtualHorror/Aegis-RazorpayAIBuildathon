import { describe, expect, it } from 'vitest';
import { maskContact, maskEmail, maskPii } from './mask';

describe('PII masking', () => {
  it('keeps an email domain but hides the local address', () => {
    expect(maskEmail('alice@example.com')).toBe('a••••@example.com');
    expect(maskEmail('alice@example.com')).not.toContain('alice');
  });

  it('keeps the country prefix and last four contact digits', () => {
    expect(maskContact('+919876543210')).toBe('+91••••••3210');
    expect(maskContact('+14155551234')).toBe('+1••••••1234');
  });

  it('deep-copies and masks nested known fields without mutating the input', () => {
    const source = { customer: { name: 'Alice Example', email: 'alice@example.com', contact: '+919876543210' }, untouched: 3 };
    const masked = maskPii(source) as { customer: { name: string; email: string; contact: string }; untouched: number };
    expect(masked).toEqual({
      customer: { name: 'A••••', email: 'a••••@example.com', contact: '+91••••••3210' },
      untouched: 3,
    });
    expect(source.customer.email).toBe('alice@example.com');
    expect(source.customer.contact).toBe('+919876543210');
  });

  it('masks nested card number and security fields before prompting', () => {
    const source = {
      card: { number: '4111 1111 1111 1111', cvv: '123', expiry_month: '09', expiry_year: '2030' },
    };
    const masked = maskPii(source) as { card: Record<string, string> };
    expect(masked.card.number).toContain('1111');
    expect(masked.card.number).not.toContain('4111 1111 1111');
    expect(masked.card.cvv).toBe('•••');
    expect(masked.card.expiry_month).toBe('••');
    expect(masked.card.expiry_year).toBe('••••');
    expect(source.card.number).toBe('4111 1111 1111 1111');
  });
});
