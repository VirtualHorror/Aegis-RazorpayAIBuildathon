import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('openai', () => {
  class MockOpenAI {
    readonly chat = { completions: { create: mocks.create } };
  }
  return { default: MockOpenAI };
});

import { OpenAILlmClient } from './openai';
import { LlmUnavailableError } from './client';

const schema = z.object({ answer: z.number() });
const request = {
  purpose: 'text_to_sql' as const,
  system: 'Return an answer.',
  user: 'What is the answer?',
  schema,
};

describe('OpenAILlmClient', () => {
  beforeEach(() => mocks.create.mockReset());

  it('requests JSON mode and extracts the first balanced object', async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: 'Here is the result: {"answer":42,"note":"brace } in text"}.' } }],
      usage: { prompt_tokens: 13, completion_tokens: 8 },
    });

    const client = new OpenAILlmClient({ model: 'gpt-test', modelFast: 'gpt-fast' });
    const result = await client.completeJson({ ...request, maxTokens: 77, tier: 'fast' });

    expect(result.data).toEqual({ answer: 42 });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-fast');
    expect(result.tokensIn).toBe(13);
    expect(result.tokensOut).toBe(8);
    expect(result.raw).toContain('{"answer":42');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({
      model: 'gpt-fast',
      messages: [
        { role: 'system', content: 'Return an answer.\nRespond with a single JSON object only.' },
        { role: 'user', content: request.user },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 77,
    });
  });

  it('retries once without response_format when a proxy rejects JSON mode', async () => {
    const proxyError = Object.assign(new Error('response_format is not supported'), { status: 400 });
    mocks.create.mockRejectedValueOnce(proxyError).mockResolvedValueOnce({
      choices: [{ message: { content: '{"answer":9}' } }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    });

    const client = new OpenAILlmClient({ model: 'gpt-test' });
    const result = await client.completeJson(request);

    expect(result.data).toEqual({ answer: 9 });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1]?.[0]).not.toHaveProperty('response_format');
  });

  it('makes one schema repair attempt and appends the validation error', async () => {
    mocks.create
      .mockResolvedValueOnce({ choices: [{ message: { content: 'not JSON' } }], usage: {} })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'prefix {"answer":12} suffix' } }], usage: {} });

    const client = new OpenAILlmClient({ model: 'gpt-test' });
    const result = await client.completeJson(request);

    expect(result.data).toEqual({ answer: 12 });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1]?.[0]).toMatchObject({
      messages: [{ role: 'system' }, { role: 'user', content: expect.stringContaining('previous response failed validation') }],
    });
    expect(mocks.create.mock.calls[1]?.[0]).toMatchObject({
      messages: [{ role: 'system' }, { role: 'user', content: expect.stringContaining('response did not contain a JSON object') }],
    });
  });

  it('fails closed after the single repair attempt still violates the schema', async () => {
    mocks.create
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"answer":"bad"}' } }], usage: {} })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"answer":"still bad"}' } }], usage: {} });

    const client = new OpenAILlmClient({ model: 'gpt-test' });
    const completion = client.completeJson(request);
    await expect(completion).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(completion).rejects.toThrow(/openai_invalid_json/);
  });
});
