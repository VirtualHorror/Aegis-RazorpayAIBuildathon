import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmClient, LlmJsonRequest, LlmJsonResult } from './client';
import { LlmUnavailableError as LlmUnavailableErrorClass } from './client';

/**
 * The only request-scoped chaos value understood by the LLM layer.
 * Intent: simulation must be able to make model calls fail deterministically without changing provider state.
 * Flow: ingress validates the development-only header -> `runWithLlmChaos` stores it for this async request -> the
 *       resilient client checks it before invoking an adapter.
 */
export interface LlmChaosContext {
  mode?: 'llm_down';
  /** Compatibility field for callers that prefer a boolean context. */
  llmDown?: boolean;
}

export const llmChaosStorage = new AsyncLocalStorage<LlmChaosContext>();

/** Alias used by request middleware and tests that prefer a shorter name. */
export const llmChaos = llmChaosStorage;
export const chaosStorage = llmChaosStorage;

export function runWithLlmChaos<T>(mode: 'llm_down' | undefined, callback: () => T): T {
  if (mode === undefined) return callback();
  return llmChaosStorage.run({ mode, llmDown: true }, callback);
}

/** Alias retained for middleware naming symmetry. */
export const withLlmChaos = runWithLlmChaos;
export const runWithChaos = runWithLlmChaos;

export function isLlmDown(): boolean {
  const context = llmChaosStorage.getStore();
  return context?.mode === 'llm_down' || context?.llmDown === true;
}

export interface LlmLogger {
  info: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

export interface LlmDescription {
  provider: string;
  model: string;
  modelFast: string;
}

export interface ResilientLlmOptions {
  /** Milliseconds before a provider call is failed as unavailable. */
  timeoutMs?: number;
  /** Number of completed calls that fail before opening the breaker. */
  failureThreshold?: number;
  /** How long an open breaker rejects calls, in milliseconds. */
  breakerOpenMs?: number;
  logger?: LlmLogger;
  description?: LlmDescription;
  /** Injectable wall clock for deterministic breaker tests. */
  now?: () => number;
  /** Alias accepted by callers that name the dependency a clock. */
  clock?: () => number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_BREAKER_OPEN_MS = 60_000;
const TRANSIENT_ERROR = /(?:RateLimit|Connection|5xx|timeout)/i;

const NOOP_LOGGER: LlmLogger = Object.freeze({ info: () => undefined });

/**
 * Add bounded failure handling around any provider adapter.
 * Intent: callers see one JSON-only client even when a provider is slow, transiently unavailable, or repeatedly down.
 * Flow: chaos/breaker guard -> timed provider attempt -> at most one transient retry -> update breaker -> info log.
 */
export class ResilientLlmClient implements LlmClient {
  readonly provider: string;

  private readonly inner: LlmClient;
  private readonly timeoutMs: number;
  private readonly failureThreshold: number;
  private readonly breakerOpenMs: number;
  private readonly logger: LlmLogger;
  private readonly clock: () => number;
  private readonly description?: LlmDescription;
  private consecutiveFailures = 0;
  private openedAt: number | undefined;

  constructor(inner: LlmClient, options: ResilientLlmOptions = {}) {
    this.inner = inner;
    this.provider = inner.provider;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.breakerOpenMs = options.breakerOpenMs ?? DEFAULT_BREAKER_OPEN_MS;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.clock = options.clock ?? options.now ?? Date.now;
    this.description = options.description;
  }

  describe(): LlmDescription {
    if (this.description) return this.description;
    const described = readDescription(this.inner);
    return {
      provider: this.provider,
      model: described?.model ?? '',
      modelFast: described?.modelFast ?? described?.model ?? '',
    };
  }

  async completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const startedAt = this.clock();
    let result: LlmJsonResult<T> | undefined;
    let failure: unknown;
    try {
      if (isLlmDown()) {
        throw new LlmUnavailableErrorClass('chaos_llm_down');
      }

      this.assertBreakerClosed();

      let attempt = 0;
      while (true) {
        try {
          result = await this.completeWithTimeout(req);
          failure = undefined;
          this.recordSuccess();
          return result;
        } catch (error) {
          if (attempt === 0 && isTransientUnavailable(error)) {
            attempt += 1;
            continue;
          }
          failure = normalizeUnavailable(error);
          this.recordFailure();
          throw failure;
        }
      }
    } catch (error) {
      failure = normalizeUnavailable(error);
      throw failure;
    } finally {
      const description = this.describe();
      const latencyMs = Math.max(0, Math.round(this.clock() - startedAt));
      const ok = result !== undefined && failure === undefined;
      this.logger.info({
        purpose: req.purpose,
        provider: result?.provider ?? description.provider,
        model: result?.model ?? description.model,
        latencyMs,
        tokensIn: result?.tokensIn ?? 0,
        tokensOut: result?.tokensOut ?? 0,
        ok,
      }, 'llm.complete_json');
    }
  }

  private assertBreakerClosed(): void {
    if (this.openedAt === undefined) return;
    const elapsed = this.clock() - this.openedAt;
    if (elapsed < this.breakerOpenMs) {
      throw new LlmUnavailableErrorClass('circuit_open');
    }
    this.openedAt = undefined;
    this.consecutiveFailures = 0;
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = undefined;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = this.clock();
    }
  }

  private async completeWithTimeout<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    // Intent: AbortSignal.timeout provides one hard upper bound for every adapter invocation.
    // Flow: create the signal -> reject with the stable `timeout` error when it aborts -> race the provider promise.
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const timeout = new Promise<never>((_, reject) => {
      const onAbort = (): void => reject(new LlmUnavailableErrorClass('timeout'));
      if (timeoutSignal.aborted) {
        onAbort();
        return;
      }
      timeoutSignal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([this.inner.completeJson(req), timeout]);
  }
}

export function createResilientLlmClient(inner: LlmClient, options?: ResilientLlmOptions): ResilientLlmClient {
  return new ResilientLlmClient(inner, options);
}

export { ResilientLlmClient as ResilientClient };

function isTransientUnavailable(error: unknown): boolean {
  return error instanceof LlmUnavailableErrorClass && TRANSIENT_ERROR.test(error.message);
}

function normalizeUnavailable(error: unknown): Error {
  if (error instanceof LlmUnavailableErrorClass) return error;
  if (error instanceof Error) return new LlmUnavailableErrorClass(error.message, { cause: error });
  return new LlmUnavailableErrorClass(String(error));
}

function readDescription(client: LlmClient): LlmDescription | undefined {
  if ('describe' in client && typeof client.describe === 'function') {
    const value = client.describe();
    return isDescription(value) ? value : undefined;
  }
  if ('model' in client && typeof client.model === 'string') {
    const model = client.model;
    const modelFast = 'modelFast' in client && typeof client.modelFast === 'string' ? client.modelFast : model;
    return { provider: client.provider, model, modelFast };
  }
  return undefined;
}

function isDescription(value: unknown): value is LlmDescription {
  if (typeof value !== 'object' || value === null) return false;
  if (!('provider' in value) || !('model' in value) || !('modelFast' in value)) return false;
  return typeof value.provider === 'string' && typeof value.model === 'string' && typeof value.modelFast === 'string';
}
