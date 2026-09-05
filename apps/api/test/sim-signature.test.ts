import { describe, expect, it } from 'vitest';
import { computeSignature } from '../src/ingress/signature';
import { computeSignature as simulatorSignature } from '../../../scripts/sim/signer';

describe('simulator webhook signer', () => {
  it('matches the ingress HMAC for the exact same bytes', () => {
    const raw = Buffer.from('{"entity":"event","event":"payment.failed"}');
    const secret = 'test_webhook_secret_16';
    expect(simulatorSignature(raw, secret)).toBe(computeSignature(raw, secret));
  });
});
