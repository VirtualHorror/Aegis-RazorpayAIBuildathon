import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

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
});
