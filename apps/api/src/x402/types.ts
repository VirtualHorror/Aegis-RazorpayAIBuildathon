import type { FastifyRequest } from 'fastify';

export interface X402Payload {
  readonly nonce: string;
  readonly amount: string;
  readonly asset: string;
  readonly payTo: string;
  readonly payer: string;
  readonly issuedAt: string;
  readonly signature: string;
}

export interface X402Price { readonly amountPaise: number; readonly description: string }
export type PriceFor = (request: FastifyRequest) => Promise<X402Price>;
export type X402Rejection = 'invalid_payment_header' | 'unknown_nonce' | 'nonce_expired' | 'nonce_already_settled' | 'amount_below_required' | 'bad_signature' | 'amount_exceeds_policy' | 'payer_daily_cap_exceeded';

export interface X402RequestContext {
  readonly resource: string;
  readonly method: string;
}
