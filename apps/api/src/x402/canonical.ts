import { createHmac, timingSafeEqual } from 'node:crypto';
import type { X402Payload } from './types';

export function canonicalPayment(payload: Pick<X402Payload, 'nonce' | 'amount' | 'asset' | 'payTo' | 'payer' | 'issuedAt'>): string {
  return [payload.nonce, payload.amount, payload.asset, payload.payTo, payload.payer, payload.issuedAt].join('|');
}

export function signPayment(payload: Pick<X402Payload, 'nonce' | 'amount' | 'asset' | 'payTo' | 'payer' | 'issuedAt'>, secret: string): string {
  return createHmac('sha256', secret).update(canonicalPayment(payload)).digest('hex');
}

export function verifyPaymentSignature(payload: X402Payload, secret: string): boolean {
  const expected = Buffer.from(signPayment(payload, secret), 'hex');
  const actual = Buffer.from(payload.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
