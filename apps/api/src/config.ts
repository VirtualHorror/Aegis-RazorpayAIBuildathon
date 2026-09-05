import { z } from 'zod';

/**
 * Typed configuration from environment variables.
 * Intent: fail fast with a readable message on a bad environment instead of failing later at 2 AM with `undefined`.
 * Flow:   server.ts loads `.env` → loadConfig(process.env) → Config is passed explicitly to every builder (no globals).
 * Every new variable is added here AND in `.env.example` (Checklist global constraints).
 */
const boolFromString = z.preprocess(
  (value) => (typeof value === 'string' ? ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()) : value),
  z.boolean(),
);

// Intent: optional credentials are commonly represented by blank values in `.env`; treat those as absent so `auto`
//         can select the next available provider instead of failing configuration validation at boot.
// Flow: blank string -> undefined -> optional string schema; non-blank values retain their exact spelling.
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see .env.example)'),
  DATABASE_URL_READONLY: z.string().min(1).optional(),
  DATABASE_URL_TEST: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(16, 'RAZORPAY_WEBHOOK_SECRET must be at least 16 characters'),
  AEGIS_ALLOW_PENDING_MIGRATIONS: boolFromString.default(false),
  AEGIS_WORKER_ENABLED: boolFromString.default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  WORKER_POLL_MS: z.coerce.number().int().min(10).max(60_000).default(500),
  AEGIS_LLM_PROVIDER: z.enum(['auto', 'anthropic', 'openai', 'stub']).default('auto'),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5'),
  ANTHROPIC_MODEL_FAST: z.string().min(1).default('claude-opus-5'),
  OPENAI_API_KEY: optionalString,
  OPENAI_API_BASE: optionalString,
  OPENAI_BASE_URL: optionalString,
  OPENAI_MODEL: z.string().min(1).default('gpt-5.6'),
  OPENAI_MODEL_FAST: z.string().min(1).default('gpt-5.4-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1).max(120_000).default(20_000),
});

export type Config = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join('\n')}\nCopy .env.example to .env and fill in the values.`);
  }
  return parsed.data;
}
