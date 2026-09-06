import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseTrustProxy } from './config';

const minimal = {
  DATABASE_URL: 'postgres://aegis:pw@localhost:5432/aegis',
  RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const cfg = loadConfig(minimal);
    expect(cfg.API_PORT).toBe(4000);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.WEB_ORIGIN).toBe('http://localhost:3000');
    expect(cfg.AEGIS_ALLOW_PENDING_MIGRATIONS).toBe(false);
    expect(cfg.AEGIS_WORKER_ENABLED).toBe(true);
    expect(cfg.WORKER_CONCURRENCY).toBe(4);
    expect(cfg.WORKER_POLL_MS).toBe(500);
    expect(cfg.AEGIS_LLM_PROVIDER).toBe('auto');
    expect(cfg.ANTHROPIC_MODEL).toBe('claude-opus-5');
    expect(cfg.OPENAI_MODEL).toBe('gpt-5.6');
    expect(cfg.OPENAI_MODEL_FAST).toBe('gpt-5.4-mini');
    expect(cfg.LLM_TIMEOUT_MS).toBe(20_000);
  });
  it('coerces numbers and booleans from strings', () => {
    const cfg = loadConfig({ ...minimal, API_PORT: '4100', AEGIS_ALLOW_PENDING_MIGRATIONS: 'true' });
    expect(cfg.API_PORT).toBe(4100);
    expect(cfg.AEGIS_ALLOW_PENDING_MIGRATIONS).toBe(true);
  });
  it('fails fast with the offending variable named', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...minimal, API_PORT: '99999' })).toThrow(/API_PORT/);
    expect(() => loadConfig({ ...minimal, WEB_ORIGIN: 'not-a-url' })).toThrow(/WEB_ORIGIN/);
    expect(() => loadConfig({ ...minimal, RAZORPAY_WEBHOOK_SECRET: 'short' })).toThrow(/RAZORPAY_WEBHOOK_SECRET/);
  });

  it('treats blank optional provider credentials and URLs as absent', () => {
    const cfg = loadConfig({
      ...minimal,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      OPENAI_API_BASE: '',
      OPENAI_BASE_URL: '',
    });
    expect(cfg.ANTHROPIC_API_KEY).toBeUndefined();
    expect(cfg.OPENAI_API_KEY).toBeUndefined();
    expect(cfg.OPENAI_API_BASE).toBeUndefined();
    expect(cfg.OPENAI_BASE_URL).toBeUndefined();
  });
});

describe('parseTrustProxy', () => {
  it('defaults to no proxy so a client cannot pick its own rate-limit bucket', () => {
    expect(loadConfig(minimal).TRUST_PROXY).toBe('');
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy(' false ')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });
  it('trusts every hop only when asked in so many words', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('TRUE')).toBe(true);
    expect(parseTrustProxy('1')).toBe(true);
  });
  it('passes an address list or the loopback keyword through to Fastify unchanged', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy(' 127.0.0.1, 10.0.0.0/8 ')).toBe('127.0.0.1, 10.0.0.0/8');
  });
});
