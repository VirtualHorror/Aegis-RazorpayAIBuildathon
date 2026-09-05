import { describe, expect, it, vi } from 'vitest';
import { createLlmClient, resolveProvider } from './factory';

const baseConfig = {
  AEGIS_LLM_PROVIDER: 'auto' as const,
  ANTHROPIC_API_KEY: undefined,
  ANTHROPIC_MODEL: 'claude-test',
  ANTHROPIC_MODEL_FAST: 'claude-fast',
  OPENAI_API_KEY: undefined,
  OPENAI_API_BASE: undefined,
  OPENAI_BASE_URL: undefined,
  OPENAI_MODEL: 'gpt-test',
  OPENAI_MODEL_FAST: 'gpt-fast',
  LLM_TIMEOUT_MS: 20_000,
};

describe('LLM factory', () => {
  it('resolves auto to anthropic, then openai, then stub based on credentials', () => {
    expect(resolveProvider({ ...baseConfig, ANTHROPIC_API_KEY: 'anthropic-key' })).toBe('anthropic');
    expect(resolveProvider({ ...baseConfig, OPENAI_API_KEY: 'openai-key' })).toBe('openai');
    expect(resolveProvider(baseConfig)).toBe('stub');
  });

  it('constructs a described stub client and logs selection once', () => {
    const info = vi.fn();
    const client = createLlmClient(baseConfig, { info });

    expect(client.provider).toBe('stub');
    expect(client.describe()).toEqual({ provider: 'stub', model: 'fixture-v1', modelFast: 'fixture-v1' });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toMatchObject({ provider: 'stub', model: 'fixture-v1', modelFast: 'fixture-v1' });
  });
});
