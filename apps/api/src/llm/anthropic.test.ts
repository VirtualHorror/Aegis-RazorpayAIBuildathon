import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  zodOutputFormat: vi.fn((schema: unknown) => ({ type: 'json_schema', schema })),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    readonly messages = { parse: mocks.parse };
  }
  return { default: MockAnthropic };
});
vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({ zodOutputFormat: mocks.zodOutputFormat }));

import { AnthropicLlmClient } from './anthropic';
import { LlmUnavailableError } from './client';

const schema = z.object({ answer: z.number() });
const request = {
  purpose: 'text_to_sql' as const,
  system: 'Return an answer.',
  user: 'What is the answer?',
  schema,
};

describe('AnthropicLlmClient', () => {
  beforeEach(() => {
    mocks.parse.mockReset();
    mocks.zodOutputFormat.mockClear();
  });

  it('uses structured parsing and returns validated metadata', async () => {
    mocks.parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { answer: 42 },
      content: [{ type: 'text', text: '{"answer":42}' }],
      usage: { input_tokens: 11, output_tokens: 7 },
    });

    const client = new AnthropicLlmClient({ model: 'claude-test', modelFast: 'claude-fast' });
    const result = await client.completeJson({ ...request, maxTokens: 123, tier: 'fast' });

    expect(result.data).toEqual({ answer: 42 });
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-fast');
    expect(result.tokensIn).toBe(11);
    expect(result.tokensOut).toBe(7);
    expect(result.raw).toBe('{"answer":42}');
    expect(mocks.zodOutputFormat).toHaveBeenCalledWith(schema);
    expect(mocks.parse).toHaveBeenCalledWith({
      model: 'claude-fast',
      max_tokens: 123,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
      output_config: { format: { type: 'json_schema', schema } },
    });
  });

  it('rejects refusals and missing parsed output as unavailable', async () => {
    mocks.parse.mockResolvedValue({
      stop_reason: 'refusal',
      parsed_output: null,
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const client = new AnthropicLlmClient();
    await expect(client.completeJson(request)).rejects.toMatchObject({
      name: 'LlmUnavailableError',
      reason: 'anthropic_unparsable',
    });
    await expect(client.completeJson(request)).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('includes SDK error class names when translating provider failures', async () => {
    class RateLimitError extends Error {}
    mocks.parse.mockRejectedValue(new RateLimitError('slow down'));

    const client = new AnthropicLlmClient();
    await expect(client.completeJson(request)).rejects.toThrow(/anthropic_RateLimitError/);
  });

  it('rejects parsed output that does not satisfy the request schema', async () => {
    mocks.parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { answer: 'not a number' },
      content: [{ type: 'text', text: '{"answer":"not a number"}' }],
      usage: {},
    });

    const client = new AnthropicLlmClient();
    await expect(client.completeJson(request)).rejects.toMatchObject({ reason: 'anthropic_unparsable' });
  });
});
