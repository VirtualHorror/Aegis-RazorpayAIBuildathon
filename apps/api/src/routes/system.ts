import type { FastifyPluginAsync } from 'fastify';
import type { LlmDescription } from '../llm/resilient';

export interface SystemRouteOptions {
  llm: {
    describe?: () => LlmDescription;
    provider: string;
  };
  /** `NODE_ENV` of the running process; the dashboard shows it in the environment pill. */
  env?: string;
  /** Application version from `@aegis/shared`. */
  version?: string;
}

export interface SystemInfo extends LlmDescription {
  env: string;
  version: string;
  /** Always true in this build: WhatsApp, x402 settlement and Razorpay calls are simulated (C-B7). */
  simulated: true;
}

/**
 * Dashboard system metadata.
 * Intent: expose provider/model selection and the runtime environment without touching PostgreSQL or leaking credentials.
 * Flow: read the already-resolved LLM client -> return only its public description plus env/version/simulation flags.
 */
export const systemRoutes: FastifyPluginAsync<SystemRouteOptions> = async (app, options) => {
  app.get('/api/v1/system', { config: { rateLimit: false } }, async (): Promise<SystemInfo> => {
    const description = options.llm.describe?.() ?? { provider: options.llm.provider, model: '', modelFast: '' };
    return { ...description, env: options.env ?? 'development', version: options.version ?? '', simulated: true };
  });
};
