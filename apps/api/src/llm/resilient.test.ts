import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  LlmUnavailableError,
  type LlmClient,
  type LlmJsonRequest,
} from './client';
import { ResilientLlmClient, runWithLlmChaos, type LlmLogger } from './resilient';

const request: LlmJsonRequest<{ ok: boolean }> = {
  purpose: 'diagnose_payment_failure',
  system: 'system',
  user: 'user',
  schema: z.object({ ok: z.boolean() }),
};

interface RawResult {
  data: unknown;
  provider: string;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  raw: string;
}

function result(data: unknown = { ok: true }): RawResult {
  return { data, provider: 'test', model: 'test-model', latencyMs: 1, tokensIn: 2, tokensOut: 3, raw: JSON.stringify(data) };
}

function client(complete: () => Promise<RawResult>): LlmClient {
  return {
    provider: 'test',
    completeJson: async <T>(req: LlmJsonRequest<T>) => {
      const output = await complete();
      const parsed = req.schema.safeParse(output.data);
      if (!parsed.success) throw new LlmUnavailableError('test_invalid_result');
      return { ...output, data: parsed.data };
    },
  };
}

describe('ResilientLlmClient', () => {
  it('fails a hanging provider call at the configured timeout', async () => {
    const inner = client(async () => new Promise<RawResult>(() => undefined));
    const wrapped = new ResilientLlmClient(inner, { timeoutMs: 10 });

    await expect(wrapped.completeJson(request)).rejects.toMatchObject({ message: 'timeout' });
  });

  it('retries one typed transient failure and returns the second result', async () => {
    let calls = 0;
    const inner = client(async () => {
      calls += 1;
      if (calls === 1) throw new LlmUnavailableError('Connection reset');
      return result();
    });
    const wrapped = new ResilientLlmClient(inner);

    await expect(wrapped.completeJson(request)).resolves.toMatchObject({ data: { ok: true } });
    expect(calls).toBe(2);
  });

  it('does not retry a plain error even when its message looks transient', async () => {
    let calls = 0;
    const inner = client(async () => {
      calls += 1;
      throw new Error('Connection reset');
    });
    const wrapped = new ResilientLlmClient(inner);

    await expect(wrapped.completeJson(request)).rejects.toMatchObject({ message: 'Connection reset' });
    expect(calls).toBe(1);
  });

  it('opens after three failed calls and reopens after the injected window', async () => {
    let now = 1_000;
    let calls = 0;
    const inner = client(async () => {
      calls += 1;
      if (calls < 4) throw new LlmUnavailableError('provider_down');
      return result();
    });
    const wrapped = new ResilientLlmClient(inner, { now: () => now, breakerOpenMs: 60_000 });

    await expect(wrapped.completeJson(request)).rejects.toThrow('provider_down');
    await expect(wrapped.completeJson(request)).rejects.toThrow('provider_down');
    await expect(wrapped.completeJson(request)).rejects.toThrow('provider_down');
    await expect(wrapped.completeJson(request)).rejects.toThrow('circuit_open');
    expect(calls).toBe(3);

    now += 60_000;
    await expect(wrapped.completeJson(request)).resolves.toMatchObject({ data: { ok: true } });
    expect(calls).toBe(4);
  });

  it('logs one structured info record for each logical call', async () => {
    const info = vi.fn<NonNullable<LlmLogger['info']>>();
    const inner = client(async () => result());
    const wrapped = new ResilientLlmClient(inner, {
      description: { provider: 'test', model: 'test-model', modelFast: 'test-fast' },
      logger: { info },
    });

    await wrapped.completeJson(request);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      purpose: request.purpose,
      provider: 'test',
      model: 'test-model',
      tokensIn: 2,
      tokensOut: 3,
      ok: true,
    });
  });

  it('honours the request-scoped llm_down chaos context without invoking the provider', async () => {
    const inner = client(async () => {
      throw new Error('provider should not be called');
    });
    const wrapped = new ResilientLlmClient(inner);

    await expect(runWithLlmChaos('llm_down', () => wrapped.completeJson(request))).rejects.toThrow('chaos_llm_down');
  });
});
