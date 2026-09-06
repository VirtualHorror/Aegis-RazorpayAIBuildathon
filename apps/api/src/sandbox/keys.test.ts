import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accountIdFromRawBody, isSandboxAccountId, sandboxSecretKey, secretFingerprint, SANDBOX_SECRET_PREFIX } from './keys';

describe('sandbox key helpers', () => {
  it('builds the guardrail_config key for an account id', () => {
    expect(sandboxSecretKey('acc_LiveDemo1')).toBe('sandbox_secret_acc_LiveDemo1');
    expect(sandboxSecretKey('acc_LiveDemo1').startsWith(SANDBOX_SECRET_PREFIX)).toBe(true);
  });

  it('refuses to build a key from an account id outside the allowed charset', () => {
    expect(isSandboxAccountId("acc_x'; DROP TABLE guardrail_config; --")).toBe(false);
    expect(isSandboxAccountId('acc_ok-1')).toBe(true);
    expect(isSandboxAccountId('')).toBe(false);
    expect(isSandboxAccountId('a'.repeat(65))).toBe(false);
    expect(() => sandboxSecretKey('acc x')).toThrow(/account id/i);
  });

  it('extracts account_id from raw webhook bytes', () => {
    const raw = Buffer.from(JSON.stringify({ entity: 'event', account_id: 'acc_tenant_1', event: 'payment.failed' }));
    expect(accountIdFromRawBody(raw)).toBe('acc_tenant_1');
  });

  it('returns null instead of throwing for bodies that cannot name an account', () => {
    expect(accountIdFromRawBody(Buffer.from('{"event":'))).toBeNull();
    expect(accountIdFromRawBody(Buffer.from('{"event":"payment.failed"}'))).toBeNull();
    expect(accountIdFromRawBody(Buffer.from('[{"account_id":"acc_1"}]'))).toBeNull();
    expect(accountIdFromRawBody(Buffer.from('{"account_id":42}'))).toBeNull();
    expect(accountIdFromRawBody(Buffer.from(JSON.stringify({ account_id: "acc_'; --" })))).toBeNull();
    expect(accountIdFromRawBody(Buffer.from(JSON.stringify({ account_id: 'a'.repeat(65) })))).toBeNull();
    expect(accountIdFromRawBody(Buffer.alloc(0))).toBeNull();
  });

  it('fingerprints a secret without revealing any of it', () => {
    const secret = 'whsec_tenant_one_secret';
    const fingerprint = secretFingerprint(secret);
    expect(fingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(fingerprint).toBe(createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 12));
    expect(secret).not.toContain(fingerprint);
    expect(secretFingerprint(secret)).toBe(fingerprint);
    expect(secretFingerprint('whsec_tenant_two_secret')).not.toBe(fingerprint);
  });
});
