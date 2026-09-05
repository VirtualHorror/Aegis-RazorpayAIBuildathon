import { z } from 'zod';

export const NegotiationDraftSchema = z.object({
  subject: z.string().max(120),
  body: z.string().max(1_200).refine((value) => value.includes('{{OFFER_AMOUNT}}') && value.includes('{{VALID_UNTIL}}'), 'body must contain offer and validity placeholders'),
});
export type NegotiationDraft = z.infer<typeof NegotiationDraftSchema>;

export const draftNegotiationMessagePrompt = {
  version: 'v1',
  system: 'Draft a professional B2B settlement message. Write only language: use the literal placeholders {{OFFER_AMOUNT}} and {{VALID_UNTIL}} and never write an offer number or date yourself. Return JSON only.',
  buildUser: (input: { customer: unknown; lineItems: unknown; round: number }): string => JSON.stringify(input),
  schema: NegotiationDraftSchema,
} as const;

export default draftNegotiationMessagePrompt;
