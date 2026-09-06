import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import type { LlmClient } from '../llm/client';
import { llmKeyFromHeaders, type ByokLlmResolver } from '../llm/byok';
import { AskService } from '../nlq/service';

const AskBodySchema = z.object({ question: z.string().trim().min(1).max(4_000) });
const HistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });

export interface AskRouteOptions {
  readonly db: pg.Pool;
  readonly readonlyDb?: pg.Pool | null;
  readonly llm: LlmClient;
  /** Sandbox / BYOK (T25): resolves `x-aegis-llm-key` to a client bound to the caller's own credential. */
  readonly byok?: ByokLlmResolver;
}

export const askRoutes: FastifyPluginAsync<AskRouteOptions> = async (app, options) => {
  const service = new AskService(options);
  app.post('/api/v1/ask', async (request) => {
    const body = AskBodySchema.parse(request.body ?? {});
    // Intent: in Live mode the merchant's own key pays for this question. The service is otherwise stateless, so a
    //         request-scoped instance around the caller's client costs nothing and shares no breaker with the boot one.
    const callerKey = options.byok ? llmKeyFromHeaders(request.headers) : null;
    const scoped = callerKey && options.byok ? new AskService({ ...options, llm: options.byok.clientFor(callerKey) }) : service;
    return scoped.ask(body.question);
  });
  app.get('/api/v1/ask/history', async (request) => {
    const query = HistoryQuerySchema.parse(request.query ?? {});
    return { items: await service.history(query.limit) };
  });
};

export default askRoutes;
