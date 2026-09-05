import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmUnavailableError, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from '../llm/client';
import { ResilientLlmClient } from '../llm/resilient';
import { runProcessEventWithChaos } from './process-event';

const request: LlmJsonRequest<{ ok: boolean }> = {
  purpose: 'diagnose_payment_failure',
  system: 'system',
  user: 'user',
  schema: z.object({ ok: z.boolean() }),
};

function client(onCall: () => void): ResilientLlmClient {
  const inner: LlmClient = {
    provider: 'test',
    completeJson: async <T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> => {
      onCall();
      return {
        data: req.schema.parse({ ok: true }),
        provider: 'test',
        model: 'test-model',
        latencyMs: 1,
        tokensIn: 0,
        tokensOut: 0,
        raw: '{"ok":true}',
      };
    },
  };
  return new ResilientLlmClient(inner);
}

describe('process-event chaos context', () => {
  it('re-enters llm_down before work invokes the resilient client', async () => {
    let providerCalls = 0;
    const llm = client(() => { providerCalls += 1; });
    const job = { payload: { eventId: 'evt_worker_chaos', chaos: 'llm_down' } };

    let failure: unknown;
    try {
      await runProcessEventWithChaos(job, () => llm.completeJson(request));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LlmUnavailableError);
    if (failure instanceof LlmUnavailableError) expect(failure.reason).toBe('chaos_llm_down');
    expect(providerCalls).toBe(0);
  });

  it('leaves ordinary process_event jobs unchanged', async () => {
    let providerCalls = 0;
    const llm = client(() => { providerCalls += 1; });
    const job = { payload: { eventId: 'evt_worker_normal' } };

    await expect(runProcessEventWithChaos(job, () => llm.completeJson(request))).resolves.toMatchObject({ data: { ok: true } });
    expect(providerCalls).toBe(1);
  });
});
