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

export interface LlmFactoryLogger extends LlmLogger {
  /** Fastify/Pino exposes this method; keeping it optional makes unit-test loggers tiny. */
  warn?: (...args: unknown[]) => void;
}

type FactoryConfig = Pick<
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
 */
export function createLlmClient(config: FactoryConfig, logger: LlmFactoryLogger = NOOP_LOGGER): DescribedLlmClient {
  const provider = resolveProvider(config);
  const adapter = createAdapter(provider, config);
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
  logger.info({ provider: description.provider, model: description.model, modelFast: description.modelFast }, 'llm provider selected');
  return resilient;
}

export function resolveProvider(config: Pick<FactoryConfig, 'AEGIS_LLM_PROVIDER' | 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'>): Exclude<LlmProvider, 'auto'> {
  if (config.AEGIS_LLM_PROVIDER !== 'auto') return config.AEGIS_LLM_PROVIDER;
  if (hasCredential(config.ANTHROPIC_API_KEY)) return 'anthropic';
  if (hasCredential(config.OPENAI_API_KEY)) return 'openai';
  return 'stub';
}

function createAdapter(provider: Exclude<LlmProvider, 'auto'>, config: FactoryConfig): LlmClient {
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

function adapterModel(adapter: LlmClient, config: FactoryConfig, provider: Exclude<LlmProvider, 'auto'>): string {
  if ('model' in adapter && typeof adapter.model === 'string') return adapter.model;
  if (provider === 'anthropic') return config.ANTHROPIC_MODEL;
  if (provider === 'openai') return config.OPENAI_MODEL;
  return 'fixture-v1';
}

function adapterFastModel(adapter: LlmClient, config: FactoryConfig, provider: Exclude<LlmProvider, 'auto'>): string {
  if ('modelFast' in adapter && typeof adapter.modelFast === 'string') return adapter.modelFast;
  if (provider === 'anthropic') return config.ANTHROPIC_MODEL_FAST;
  if (provider === 'openai') return config.OPENAI_MODEL_FAST;
  return adapterModel(adapter, config, provider);
}
