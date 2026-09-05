import { z } from 'zod';

/**
 * Text parameter accepted by a Meta Cloud API template component.
 * Intent: keep the simulated outbound contract small and explicit so malformed payloads cannot reach the action log.
 * Flow: template body/button parameters validate as text -> the API stores the same parsed shape in JSONB.
 */
export const WhatsAppTemplateTextParameterSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export type WhatsAppTemplateTextParameter = z.infer<typeof WhatsAppTemplateTextParameterSchema>;

const WhatsAppTemplateBodyComponentSchema = z.object({
  type: z.literal('body'),
  parameters: z.array(WhatsAppTemplateTextParameterSchema),
});

const WhatsAppTemplateButtonComponentSchema = z.object({
  type: z.literal('button'),
  sub_type: z.literal('url'),
  index: z.literal('0'),
  parameters: z.tuple([WhatsAppTemplateTextParameterSchema]),
});

/**
 * Exact simulated WhatsApp template envelope used by CheckoutRecovery.
 * Intent: constrain channel, component types and URL button shape while allowing any approved template name/locale.
 * Flow: module builds the envelope -> this schema validates it -> execution persists the validated payload unchanged.
 */
export const WhatsAppTemplateMessageSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  to: z.string().min(1),
  type: z.literal('template'),
  template: z.object({
    name: z.string().min(1),
    language: z.object({ code: z.string().min(1) }),
    components: z.tuple([
      WhatsAppTemplateBodyComponentSchema,
      WhatsAppTemplateButtonComponentSchema,
    ]),
  }),
});

export type WhatsAppTemplateMessage = z.infer<typeof WhatsAppTemplateMessageSchema>;
/** Compatibility alias for callers that refer to the contract by its domain name rather than the `Schema` suffix. */
export const WhatsAppTemplateMessage = WhatsAppTemplateMessageSchema;
