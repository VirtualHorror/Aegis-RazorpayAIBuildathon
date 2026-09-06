import type { IncomingHttpHeaders } from 'node:http';
import { secretFingerprint } from '../sandbox/keys';
import type { LlmClient } from './client';
import { createLlmClient, type DescribedLlmClient, type LlmFactoryConfig, type LlmFactoryLogger } from './factory';

/**
 * Bring-your-own-key model credentials (Sandbox / BYOK, T25).
 * Intent: in Live mode the merchant's own provider key rides on the request and pays for that request's model calls.
 *         The key is never written to the database, never logged, and never mixed into the boot client other tenants
 *         share — only its fingerprint is allowed to leave this module.
 * Flow: route reads `x-aegis-llm-key` -> `llmKeyFromHeaders` validates the shape -> the registry hands back the one
 *       client bound to that key -> a queued job carries only `secretFingerprint(key)` and resolves it here again.
 */

export const LLM_KEY_HEADER = 'x-aegis-llm-key';

/** Provider keys are long opaque ASCII tokens; anything shorter or with control characters is not one. */
const MIN_KEY_LENGTH = 20;
const MAX_KEY_LENGTH = 512;
const KEY_PATTERN = /^[\x21-\x7e]+$/;
const DEFAULT_MAX_ENTRIES = 16;

/**
 * Read the caller's provider key off the request headers.
 * Intent: a value that reaches an HTTP client (or a log line) must be one header value with no control characters, so
 *         an implausible header is dropped rather than forwarded — the request then falls back to the `.env` client.
 * Flow: reject a repeated header (which of the two is the tenant's?) -> trim -> bound the length -> require printable
 *       ASCII, which excludes the CR/LF that would otherwise let a caller append headers downstream.
 */
export function llmKeyFromHeaders(headers: IncomingHttpHeaders): string | null {
  const raw = headers[LLM_KEY_HEADER];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length < MIN_KEY_LENGTH || value.length > MAX_KEY_LENGTH) return null;
  return KEY_PATTERN.test(value) ? value : null;
}

/**
 * What a route needs from the registry; tests inject a fake so the routing decision is provable without a provider.
 */
export interface ByokLlmResolver {
  clientFor(apiKey: string): LlmClient;
  remember(apiKey: string): string;
  byFingerprint(fingerprint: string): LlmClient | null;
}

/**
 * Pick the client for a queued job.
 * Intent: the job payload may carry the fingerprint a request left behind; if this process still holds that key the
 *         job runs on it, otherwise (restart, eviction, no BYOK at all) it runs on the boot client — silently
 *         degrading to the deployment's own credentials is the honest fallback for work already accepted.
 */
export function llmForFingerprint(fingerprint: unknown, base: LlmClient, byok: ByokLlmResolver | undefined): LlmClient {
  if (!byok || typeof fingerprint !== 'string' || fingerprint.length === 0) return base;
  return byok.byFingerprint(fingerprint) ?? base;
}

export interface ByokLlmRegistryOptions {
  readonly config: LlmFactoryConfig;
  readonly logger?: LlmFactoryLogger;
  /** Upper bound on cached clients; the least recently used is dropped past it. */
  readonly maxEntries?: number;
}

/**
 * Bounded per-key client cache.
 * Intent: `ResilientLlmClient` carries the retry budget and the circuit breaker, so a key needs *one* client for those
 *         to mean anything across requests — and one tenant's dead key must not open the breaker of another's. A hard
 *         entry cap keeps a stream of distinct keys from growing the process without bound.
 * Flow: fingerprint the key -> reuse or construct its client -> re-insert it as most-recently-used -> evict the oldest
 *       entry (Map preserves insertion order) once the cap is exceeded.
 */
export class ByokLlmRegistry implements ByokLlmResolver {
  private readonly config: LlmFactoryConfig;
  private readonly logger: LlmFactoryLogger | undefined;
  private readonly maxEntries: number;
  private readonly clients = new Map<string, DescribedLlmClient>();

  constructor(options: ByokLlmRegistryOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  get size(): number {
    return this.clients.size;
  }

  clientFor(apiKey: string): DescribedLlmClient {
    const fingerprint = secretFingerprint(apiKey);
    const existing = this.clients.get(fingerprint);
    if (existing) {
      this.clients.delete(fingerprint);
      this.clients.set(fingerprint, existing);
      return existing;
    }
    const client = this.logger
      ? createLlmClient(this.config, this.logger, { apiKey })
      : createLlmClient(this.config, undefined, { apiKey });
    this.clients.set(fingerprint, client);
    while (this.clients.size > this.maxEntries) {
      const oldest = this.clients.keys().next();
      if (oldest.done) break;
      this.clients.delete(oldest.value);
    }
    return client;
  }

  /**
   * Bind a key to its fingerprint so work queued now can use it later.
   * Intent: a durable job row must never hold a credential (C-D3), but a manually triggered scan should still run on
   *         the key that triggered it. The fingerprint is safe to persist; the key stays in this process only, so a
   *         restart simply falls back to the `.env` client instead of leaking anything.
   */
  remember(apiKey: string): string {
    this.clientFor(apiKey);
    return secretFingerprint(apiKey);
  }

  byFingerprint(fingerprint: string): DescribedLlmClient | null {
    return this.clients.get(fingerprint) ?? null;
  }
}
