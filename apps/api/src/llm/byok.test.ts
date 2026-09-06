import { describe, expect, it } from 'vitest';
import { secretFingerprint } from '../sandbox/keys';
import { ByokLlmRegistry, LLM_KEY_HEADER, llmForFingerprint, llmKeyFromHeaders } from './byok';
import { StubLlmClient } from './stub';

const config = {
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

const keyA = 'sk-proj-tenant-a-0123456789';
const keyB = 'sk-proj-tenant-b-0123456789';

describe('llmKeyFromHeaders', () => {
  it('reads a plausible provider key from the BYOK header', () => {
    expect(LLM_KEY_HEADER).toBe('x-aegis-llm-key');
    expect(llmKeyFromHeaders({ [LLM_KEY_HEADER]: keyA })).toBe(keyA);
    expect(llmKeyFromHeaders({ [LLM_KEY_HEADER]: `  ${keyA}  ` })).toBe(keyA);
  });

  it('returns null for an absent, implausible, or ambiguous header rather than calling a provider with it', () => {
    expect(llmKeyFromHeaders({})).toBeNull();
    expect(llmKeyFromHeaders({ [LLM_KEY_HEADER]: '' })).toBeNull();
    expect(llmKeyFromHeaders({ [LLM_KEY_HEADER]: '   ' })).toBeNull();
    expect(llmKeyFromHeaders({ [LLM_KEY_HEADER]: 'sk-tooshort' })).toBeNull();
    expect(llmKeyFromHeaders({ [LLM_KEY_HEADER]: `${keyA}\nx-injected: 1` })).toBeNull();
    expect(llmKeyFromHeaders({ [LLM_KEY_HEADER]: `sk-proj-${'x'.repeat(600)}` })).toBeNull();
    expect(llmKeyFromHeaders({ [LLM_KEY_HEADER]: [keyA, keyB] })).toBeNull();
  });
});

describe('ByokLlmRegistry', () => {
  it('reuses one client per key so a failing tenant key opens only its own breaker', () => {
    const registry = new ByokLlmRegistry({ config });
    const first = registry.clientFor(keyA);

    expect(registry.clientFor(keyA)).toBe(first);
    expect(registry.clientFor(keyB)).not.toBe(first);
    expect(registry.size).toBe(2);
  });

  it('evicts the least recently used key so the cache cannot grow without bound', () => {
    const registry = new ByokLlmRegistry({ config, maxEntries: 2 });
    const first = registry.clientFor(keyA);
    registry.clientFor(keyB);
    registry.clientFor(keyA); // keyA is now the most recently used, keyB the least
    registry.clientFor('sk-proj-tenant-c-0123456789');

    expect(registry.size).toBe(2);
    expect(registry.clientFor(keyA)).toBe(first);
    expect(registry.byFingerprint(secretFingerprint(keyB))).toBeNull();
  });

  it('resolves a remembered key by fingerprint so a queued job never carries the secret', () => {
    const registry = new ByokLlmRegistry({ config });
    const fingerprint = registry.remember(keyA);

    expect(fingerprint).toBe(secretFingerprint(keyA));
    expect(registry.byFingerprint(fingerprint)).toBe(registry.clientFor(keyA));
    expect(registry.byFingerprint(secretFingerprint(keyB))).toBeNull();
    expect(registry.byFingerprint('not-a-fingerprint')).toBeNull();
  });
});

describe('llmForFingerprint', () => {
  const base = new StubLlmClient();

  it('resolves a remembered fingerprint to that key\'s client', () => {
    const registry = new ByokLlmRegistry({ config });
    const fingerprint = registry.remember(keyA);

    expect(llmForFingerprint(fingerprint, base, registry)).toBe(registry.clientFor(keyA));
  });

  it('falls back to the boot client whenever the key is not in this process', () => {
    const registry = new ByokLlmRegistry({ config });

    expect(llmForFingerprint(secretFingerprint(keyB), base, registry)).toBe(base);
    expect(llmForFingerprint(undefined, base, registry)).toBe(base);
    expect(llmForFingerprint(42, base, registry)).toBe(base);
    expect(llmForFingerprint(secretFingerprint(keyA), base, undefined)).toBe(base);
  });
});
