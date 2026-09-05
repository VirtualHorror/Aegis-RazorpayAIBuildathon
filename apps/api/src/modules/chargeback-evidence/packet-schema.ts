import { z } from 'zod';

const NullableText = z.string().nullable();

/**
 * The evidence packet is a closed, model-safe shape.
 * Intent: every dispute section is explicit so a reviewer can see what was unavailable instead of inferring it from prose.
 * Flow: deterministic assembly validates this schema -> the masked packet is sent to the narrative prompt -> the same
 * packet is persisted with the pending human-review state.
 */
export const EvidencePacketSchema = z.object({
  dispute: z.object({
    id: z.string().min(1),
    amount_paise: z.number().int().nonnegative(),
    reason_code: NullableText,
    reason_description: NullableText,
    phase: z.string().min(1),
    respond_by: NullableText,
  }),
  payment: z.object({
    id: z.string().min(1),
    amount_paise: z.number().int().nonnegative(),
    method: NullableText,
    card_network: NullableText,
    card_last4: NullableText,
    captured_at: NullableText,
    international: z.boolean(),
  }),
  order: z.object({
    id: NullableText,
    items: z.array(z.unknown()),
    amount_paise: z.number().int().nonnegative(),
    receipt: NullableText,
  }),
  customer: z.object({
    id_masked: z.string().min(1),
    country: NullableText,
    locale: z.string().min(1),
    account_age_days: z.number().int().nonnegative(),
  }),
  delivery: z.object({
    carrier: NullableText,
    tracking: NullableText,
    delivered_at: NullableText,
    proof_url: NullableText,
  }).nullable(),
  communications: z.array(z.object({
    channel: z.string().min(1),
    template: z.string().min(1),
    sent_at: z.string().min(1),
  })),
  refund_policy: z.object({ url: NullableText, summary: z.string().min(1) }),
  prior_disputes: z.number().int().nonnegative(),
  missing: z.array(z.string().min(1)),
});

export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;

export const EvidencePacket = EvidencePacketSchema;
