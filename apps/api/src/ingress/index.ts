import type { FastifyPluginAsync } from 'fastify';
import { registerRawBodyParser } from './raw-body';
import { handleRazorpayWebhook, type RazorpayWebhookHandlerOptions } from './razorpay-webhook';

/**
 * Encapsulated ingress routes.
 * Intent: keep the raw parser and stricter 300/min limit scoped to Razorpay webhooks.
 * Flow: register the Buffer parser in this encapsulation -> mount POST /razorpay -> delegate to the authenticated handler.
 */
export const ingressPlugin: FastifyPluginAsync<RazorpayWebhookHandlerOptions> = async (app, options) => {
  await registerRawBodyParser(app);
  app.post(
    '/razorpay',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request, reply) => handleRazorpayWebhook(request, reply, options),
  );
};

export { computeSignature, verifySignature } from './signature';
export { reconcile } from './reconciler';
