import { z } from 'zod';

export const QuerySummarySchema = z.object({ summary: z.string().max(1_000) });
export type QuerySummaryOutput = z.infer<typeof QuerySummarySchema>;

export const summarizeQueryResultPrompt = {
  version: 'v1',
  system: 'Summarise a readonly query result in one concise sentence. Do not invent values or expose personal contact data. Return JSON only: {"summary":"..."}.',
  buildUser: (input: { question: string; rows: readonly unknown[] }): string => JSON.stringify({ question: input.question, rows: input.rows.slice(0, 20) }),
  schema: QuerySummarySchema,
} as const;

export default summarizeQueryResultPrompt;

