import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import type { LlmClient } from '../llm/client';
import { AskService } from '../nlq/service';

const AskBodySchema = z.object({ question: z.string().trim().min(1).max(4_000) });
const HistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });

export interface AskRouteOptions {
  readonly db: pg.Pool;
  readonly readonlyDb?: pg.Pool | null;
  readonly llm: LlmClient;
}

export const askRoutes: FastifyPluginAsync<AskRouteOptions> = async (app, options) => {
  const service = new AskService(options);
  app.post('/api/v1/ask', async (request) => {
    const body = AskBodySchema.parse(request.body ?? {});
    return service.ask(body.question);
  });
  app.get('/api/v1/ask/history', async (request) => {
    const query = HistoryQuerySchema.parse(request.query ?? {});
    return { items: await service.history(query.limit) };
  });
};

export default askRoutes;
