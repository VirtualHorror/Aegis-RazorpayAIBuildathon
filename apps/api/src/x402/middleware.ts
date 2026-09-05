import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Config } from '../config';
import type { EventBus } from '../bus/event-bus';
import { createChallenge } from '../db/repos/x402';
import { verifyAndSettle, X402Error, X402PausedError } from './facilitator';
import type { PriceFor, X402Payload } from './types';
import { z } from 'zod';

const Envelope = z.object({ x402Version: z.literal(1), scheme: z.literal('exact'), network: z.literal('aegis-sim'), payload: z.object({ nonce: z.string(), amount: z.string(), asset: z.literal('INR'), payTo: z.string(), payer: z.string(), issuedAt: z.string(), signature: z.string() }) });
export function x402Middleware(options: { db: pg.Pool; config: Config; bus: EventBus; priceFor: PriceFor }) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const price = await options.priceFor(request);
    const resource = `${request.protocol}://${request.hostname}${request.url}`;
    const method = request.method;
    const header = request.headers['x-payment'];
    if (!header) {
      const expiresAt = new Date(Date.now() + 60_000);
      const challenge = await createChallenge(options.db, { resource, method, amountPaise: price.amountPaise, expiresAt, requestId: request.id });
      await reply.code(402).send({ x402Version: 1, error: 'X-PAYMENT header is required', accepts: [{ scheme: 'exact', network: 'aegis-sim', maxAmountRequired: String(price.amountPaise), resource, description: price.description, mimeType: 'application/json', payTo: options.config.X402_PAY_TO, maxTimeoutSeconds: 60, asset: 'INR', extra: { nonce: challenge.nonce, expiresAt: expiresAt.toISOString(), simulated: true } }] });
      return;
    }
    try {
      const encoded = Array.isArray(header) ? header[0] : header;
      if (!encoded) throw new Error('missing payment header');
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const parsed = Envelope.parse(JSON.parse(decoded));
      const settlement = await verifyAndSettle(options.db, parsed.payload as X402Payload, price.amountPaise, options.config, options.bus, { resource, method });
      reply.header('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: true, txId: settlement.txId, network: 'aegis-sim', settledAt: settlement.settledAt })).toString('base64'));
    } catch (error) {
      if (error instanceof X402PausedError) {
        await reply.code(503).send({ error: 'gateway_paused' });
        return;
      }
      const reason = error instanceof X402Error ? error.reason : 'invalid_payment_header';
      await reply.code(402).send({ x402Version: 1, error: reason });
    }
  };
}
