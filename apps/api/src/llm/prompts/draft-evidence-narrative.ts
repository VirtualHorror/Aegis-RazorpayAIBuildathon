import { z } from 'zod';

export const EvidenceNarrativeSchema = z.object({
  narrative: z.string().max(2_000),
  confidence_note: z.string().max(300),
});

export type EvidenceNarrative = z.infer<typeof EvidenceNarrativeSchema>;

export const draftEvidenceNarrativePrompt = {
  version: 'v1',
  system: 'Write a factual dispute evidence narrative from the supplied masked packet. Do not invent facts. Return JSON only with narrative and confidence_note.',
  buildUser: (packet: unknown): string => JSON.stringify(packet),
  schema: EvidenceNarrativeSchema,
} as const;

export default draftEvidenceNarrativePrompt;
