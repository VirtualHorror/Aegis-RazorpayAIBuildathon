import type { Config } from '../config';
import { AnthropicLlmClient } from './anthropic';
import { type LlmClient, LlmUnavailableError } from './client';
import { OpenAILlmClient } from './openai';
import {
  ResilientLlmClient,
  type LlmDescription,
  type LlmLogger,
  type ResilientLlmOptions,
} from './resilient';
import { StubLlmClient } from './stub';

export type LlmProvider = 'auto' | 'anthropic' | 'openai' | 'stub';

export interface DescribedLlmClient extends LlmClient {
  describe(): LlmDescription;
}

/**
 * A caller-supplied provider credential (Sandbox / BYOK, T25).
 * Intent: a merchant in Live mode pays for their own model calls, so the key arrives per request in `x-aegis-llm-key`
 *         and must never be persisted, logged, or mixed into the boot client that other requests share.
 * Flow: route reads the header -> `createLlmClient(config, logger, { apiKey })` -> a client bound to that key only.
 */
export interface ByokCredential {
  readonly apiKey: string;
}

/** The adapter inputs a BYOK client is built from; separated so the endpoint choice below is directly testable. */
export interface ByokAdapterOptions {
  readonly apiKey: string;
  /**
   * Deliberately absent for OpenAI. `OPENAI_BASE_URL`/`OPENAI_API_BASE` point at whatever proxy the *deployer* chose;
   * forwarding somebody else's key there would hand their credential to a third party. A BYOK key goes to the
   * provider that issued it and nowhere else.
   */
  readonly baseURL?: string;
  readonly model: string;
  readonly modelFast: string;
  readonly timeoutMs: number;
}

export interface LlmFactoryLogger extends LlmLogger {
  /** Fastify/Pino exposes this method; keeping it optional makes unit-test loggers tiny. */
  warn?: (...args: unknown[]) => void;
}

export type LlmFactoryConfig = Pick<
  Config,
  | 'AEGIS_LLM_PROVIDER'
  | 'ANTHROPIC_API_KEY'
  | 'ANTHROPIC_MODEL'
  | 'ANTHROPIC_MODEL_FAST'
  | 'OPENAI_API_KEY'
  | 'OPENAI_API_BASE'
  | 'OPENAI_BASE_URL'
  | 'OPENAI_MODEL'
  | 'OPENAI_MODEL_FAST'
  | 'LLM_TIMEOUT_MS'
>;

const NOOP_LOGGER: LlmFactoryLogger = Object.freeze({ info: () => undefined });

/**
 * Resolve and wrap the configured model provider.
 * Intent: provider selection is deterministic and happens once at boot; all later calls use one resilient boundary.
 * Flow: resolve `auto` by available credentials -> construct exactly one adapter -> wrap timeout/retry/breaker -> log it.
 *       With a `byok` credential the same pipeline runs against the caller's key instead of the `.env` one; the
 *       resulting client is separate from the boot client, so one tenant's failures never open another's breaker.
 */
export function createLlmClient(
  config: LlmFactoryConfig,
  logger: LlmFactoryLogger = NOOP_LOGGER,
  byok?: ByokCredential,
): DescribedLlmClient {
  const provider = byok ? resolveByokProvider(config, byok.apiKey) : resolveProvider(config);
  const adapter = byok ? createByokAdapter(provider, config, byok.apiKey) : createAdapter(provider, config);
  const description: LlmDescription = {
    provider,
    model: adapterModel(adapter, config, provider),
    modelFast: adapterFastModel(adapter, config, provider),
  };
  const resilientOptions: ResilientLlmOptions = {
    timeoutMs: config.LLM_TIMEOUT_MS,
    logger,
    description,
  };
  const resilient = new ResilientLlmClient(adapter, resilientOptions);
  // The credential itself is never a log field (C-D3/C-D4); `byok` records only that one was used.
  logger.info(
    { provider: description.provider, model: description.model, modelFast: description.modelFast, ...(byok ? { byok: true } : {}) },
    'llm provider selected',
  );
  return resilient;
}

/**
 * Choose the provider a caller-supplied key belongs to.
 * Intent: an explicit `AEGIS_LLM_PROVIDER` is an operator decision and outranks the caller — in particular `stub`
 *         means "this deployment makes no live model calls", which BYOK must not be able to switch back on.
 * Flow: explicit provider wins -> otherwise `auto` reads the key's own prefix (`sk-ant-` is Anthropic's) -> openai.
 */
export function resolveByokProvider(
  config: Pick<LlmFactoryConfig, 'AEGIS_LLM_PROVIDER'>,
  apiKey: string,
): Exclude<LlmProvider, 'auto'> {
  if (config.AEGIS_LLM_PROVIDER !== 'auto') return config.AEGIS_LLM_PROVIDER;
  return apiKey.startsWith('sk-ant-') ? 'anthropic' : 'openai';
}

/** The adapter inputs for a BYOK client: the caller's key, this deployment's models, and the provider's own endpoint. */
export function byokAdapterOptions(
  provider: 'anthropic' | 'openai',
  config: LlmFactoryConfig,
  apiKey: string,
): ByokAdapterOptions {
  return provider === 'anthropic'
    ? { apiKey, model: config.ANTHROPIC_MODEL, modelFast: config.ANTHROPIC_MODEL_FAST, timeoutMs: config.LLM_TIMEOUT_MS }
    : { apiKey, model: config.OPENAI_MODEL, modelFast: config.OPENAI_MODEL_FAST, timeoutMs: config.LLM_TIMEOUT_MS };
}

function createByokAdapter(provider: Exclude<LlmProvider, 'auto'>, config: LlmFactoryConfig, apiKey: string): LlmClient {
  // Intent: `stub` reaches here only when the operator pinned it; the caller's key is then simply unused.
  if (provider === 'stub') return new StubLlmClient();
  const options = byokAdapterOptions(provider, config, apiKey);
  return provider === 'anthropic' ? new AnthropicLlmClient(options) : new OpenAILlmClient(options);
}

export function resolveProvider(config: Pick<LlmFactoryConfig, 'AEGIS_LLM_PROVIDER' | 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'>): Exclude<LlmProvider, 'auto'> {
  if (config.AEGIS_LLM_PROVIDER !== 'auto') return config.AEGIS_LLM_PROVIDER;
  if (hasCredential(config.ANTHROPIC_API_KEY)) return 'anthropic';
  if (hasCredential(config.OPENAI_API_KEY)) return 'openai';
  return 'stub';
}

function createAdapter(provider: Exclude<LlmProvider, 'auto'>, config: LlmFactoryConfig): LlmClient {
  switch (provider) {
    case 'anthropic':
      if (!hasCredential(config.ANTHROPIC_API_KEY)) {
        throw new LlmUnavailableError('anthropic_api_key_missing');
      }
      return new AnthropicLlmClient({
        apiKey: config.ANTHROPIC_API_KEY,
        model: config.ANTHROPIC_MODEL,
        modelFast: config.ANTHROPIC_MODEL_FAST,
        timeoutMs: config.LLM_TIMEOUT_MS,
      });
    case 'openai':
      if (!hasCredential(config.OPENAI_API_KEY)) {
        throw new LlmUnavailableError('openai_api_key_missing');
      }
      return new OpenAILlmClient({
        apiKey: config.OPENAI_API_KEY,
        baseURL: config.OPENAI_BASE_URL ?? config.OPENAI_API_BASE,
        model: config.OPENAI_MODEL,
        modelFast: config.OPENAI_MODEL_FAST,
        timeoutMs: config.LLM_TIMEOUT_MS,
      });
    case 'stub':
      return new StubLlmClient();
  }
}

function hasCredential(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function adapterModel(adapter: LlmClient, config: LlmFactoryConfig, provider: Exclude<LlmProvider, 'auto'>): string {
  if ('model' in adapter && typeof adapter.model === 'string') return adapter.model;
  if (provider === 'anthropic') return config.ANTHROPIC_MODEL;
  if (provider === 'openai') return config.OPENAI_MODEL;
  return 'fixture-v1';
}

function adapterFastModel(adapter: LlmClient, config: LlmFactoryConfig, provider: Exclude<LlmProvider, 'auto'>): string {
  if ('modelFast' in adapter && typeof adapter.modelFast === 'string') return adapter.modelFast;
  if (provider === 'anthropic') return config.ANTHROPIC_MODEL_FAST;
  if (provider === 'openai') return config.OPENAI_MODEL_FAST;
  return adapterModel(adapter, config, provider);
}
