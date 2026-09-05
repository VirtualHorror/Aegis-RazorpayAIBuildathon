import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/** Request type used after the raw-body parser has run for the ingress route. */
export interface RawBodyRequest extends FastifyRequest {
  rawBody: Buffer;
}
