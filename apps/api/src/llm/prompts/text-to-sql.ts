import { z } from 'zod';
import { SCHEMA_DOC } from '../../nlq/schema-doc';

export const TextToSqlSchema = z.object({ sql: z.string().trim().min(1).max(20_000) });
export type TextToSqlOutput = z.infer<typeof TextToSqlSchema>;

export const textToSqlPrompt = {
  version: 'v1',
  system: 'You write one PostgreSQL SELECT statement for the Aegis readonly schema. Return JSON only: {"sql":"..."}. Never write mutations, multiple statements, comments, or PII columns.',
  buildUser: (question: string): string => `${SCHEMA_DOC}\n\nQuestion: ${question}`,
  schema: TextToSqlSchema,
} as const;

export default textToSqlPrompt;
