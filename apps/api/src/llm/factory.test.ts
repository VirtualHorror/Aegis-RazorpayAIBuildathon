import { describe, expect, it, vi } from 'vitest';
import { byokAdapterOptions, createLlmClient, resolveByokProvider, resolveProvider } from './factory';

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

  describe('BYOK credential override (T25)', () => {
    it('picks the provider a caller-supplied key belongs to', () => {
      expect(resolveByokProvider({ AEGIS_LLM_PROVIDER: 'auto' }, 'sk-proj-caller')).toBe('openai');
      expect(resolveByokProvider({ AEGIS_LLM_PROVIDER: 'auto' }, 'sk-ant-caller')).toBe('anthropic');
      expect(resolveByokProvider({ AEGIS_LLM_PROVIDER: 'openai' }, 'sk-ant-caller')).toBe('openai');
      expect(resolveByokProvider({ AEGIS_LLM_PROVIDER: 'anthropic' }, 'sk-proj-caller')).toBe('anthropic');
    });

    it('never lets a caller key re-enable live calls an operator disabled with AEGIS_LLM_PROVIDER=stub', () => {
      expect(resolveByokProvider({ AEGIS_LLM_PROVIDER: 'stub' }, 'sk-proj-caller')).toBe('stub');
      const client = createLlmClient({ ...baseConfig, AEGIS_LLM_PROVIDER: 'stub' }, { info: vi.fn() }, { apiKey: 'sk-proj-caller' });
      expect(client.provider).toBe('stub');
    });

    it('sends a caller key to the official endpoint, never to the deployer proxy base URL', () => {
      const proxied = { ...baseConfig, OPENAI_BASE_URL: 'https://proxy.internal/v1', OPENAI_API_BASE: 'https://proxy.internal/v1' };
      const options = byokAdapterOptions('openai', proxied, 'sk-proj-caller');
      expect(options).toMatchObject({ apiKey: 'sk-proj-caller', model: 'gpt-test', modelFast: 'gpt-fast', timeoutMs: 20_000 });
      expect(options.baseURL).toBeUndefined();
      expect(byokAdapterOptions('anthropic', proxied, 'sk-ant-caller')).toMatchObject({ apiKey: 'sk-ant-caller', model: 'claude-test', modelFast: 'claude-fast' });
    });

    it('builds a described client from the caller key where the boot factory would have chosen stub, and logs no key', () => {
      const info = vi.fn();
      expect(resolveProvider(baseConfig)).toBe('stub');

      const client = createLlmClient(baseConfig, { info }, { apiKey: 'sk-proj-caller' });

      expect(client.provider).toBe('openai');
      expect(client.describe()).toEqual({ provider: 'openai', model: 'gpt-test', modelFast: 'gpt-fast' });
      expect(info).toHaveBeenCalledTimes(1);
      expect(info.mock.calls[0]?.[0]).toMatchObject({ provider: 'openai', byok: true });
      expect(JSON.stringify(info.mock.calls[0])).not.toContain('sk-proj-caller');
    });
  });
});
