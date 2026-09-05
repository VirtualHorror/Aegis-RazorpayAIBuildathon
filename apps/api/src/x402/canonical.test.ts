import { describe, expect, it } from 'vitest';
import { canonicalPayment, signPayment, verifyPaymentSignature } from './canonical';

const payload = { nonce: 'n1', amount: '99', asset: 'INR', payTo: 'merchant:test', payer: 'agent:a', issuedAt: '2026-09-05T00:00:00.000Z' } as const;
describe('x402 canonical payment', () => {
  it('joins fields in the wire order', () => expect(canonicalPayment(payload)).toBe('n1|99|INR|merchant:test|agent:a|2026-09-05T00:00:00.000Z'));
  it('signs and verifies with constant-time equal-length comparison', () => {
    const signature = signPayment(payload, 'a sufficiently long secret');
    expect(verifyPaymentSignature({ ...payload, signature }, 'a sufficiently long secret')).toBe(true);
    expect(verifyPaymentSignature({ ...payload, amount: '100', signature }, 'a sufficiently long secret')).toBe(false);
  });
});
