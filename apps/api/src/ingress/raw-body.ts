import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { RawBodyRequest } from '../types/fastify';

/**
 * Preserve the exact request bytes for Razorpay's HMAC check.
 * Intent: signatures cover bytes, not a JSON re-serialization that could change whitespace or key order.
 * Flow: Fastify receives application/json -> store the parser Buffer on the request -> the handler verifies before parsing.
 */
export async function registerRawBodyParser(fastify: FastifyInstance): Promise<void> {
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    (request as RawBodyRequest).rawBody = rawBody;
    done(null, rawBody);
  });
}

export const rawBodyPlugin: FastifyPluginAsync = async (fastify) => registerRawBodyParser(fastify);
