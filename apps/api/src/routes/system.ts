import type { FastifyPluginAsync } from 'fastify';
import type { LlmDescription } from '../llm/resilient';

export interface SystemRouteOptions {
  llm: {
    describe?: () => LlmDescription;
    provider: string;
  };
}

/**
 * Dashboard system metadata.
 * Intent: expose provider/model selection without touching PostgreSQL or leaking credentials.
 * Flow: read the already-resolved LLM client -> return only its public description.
 */
export const systemRoutes: FastifyPluginAsync<SystemRouteOptions> = async (app, options) => {
  app.get('/api/v1/system', { config: { rateLimit: false } }, async () => {
    const description = options.llm.describe?.();
    return description ?? { provider: options.llm.provider, model: '', modelFast: '' };
  });
};
