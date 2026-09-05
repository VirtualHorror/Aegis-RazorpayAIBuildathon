import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmUnavailableError } from './client';
// Validate the stub against the prompt registry's schema, not a fixture-local copy: that is what makes the stub a
// real guard against schema drift rather than a self-consistent mock.
import { DiagnoseOutputSchema } from './prompts';
import { StubLlmClient } from './stub';

const diagnosisRequest = (user: string) => ({
  purpose: 'diagnose_payment_failure' as const,
  system: 'Return diagnosis JSON.',
  user,
  schema: DiagnoseOutputSchema,
});
describe('StubLlmClient', () => {
  it.each([
    ['payment_authentication', 'THREE_DS_AUTH_FAILED', 'RETRY_LINK_LOCALIZED'],
    ['payment_cancelled', 'CUSTOMER_ABANDONED_CHECKOUT', 'CART_RECOVERY_NUDGE'],
    ['insufficient_funds', 'INSUFFICIENT_FUNDS', 'RETRY_ALTERNATE_METHOD'],
    ['international_transaction_not_allowed', 'CARD_NOT_ENABLED_INTERNATIONAL', 'RETRY_ALTERNATE_METHOD'],
  ])('routes %s to the deterministic diagnosis fixture', async (feature, rootCause, strategy) => {
    const result = await new StubLlmClient().completeJson(diagnosisRequest(`error_reason=${feature}`));
    expect(result.data.root_cause).toBe(rootCause);
    expect(result.data.intervention_strategy).toBe(strategy);
    expect(result.provider).toBe('stub');
    expect(result.model).toBe('fixture-v1');
    expect(result.latencyMs).toBe(5);
  });

  it('escalates unknown payment signals deterministically', async () => {
    const result = await new StubLlmClient().completeJson(diagnosisRequest('error_reason=unknown'));
    expect(result.data).toMatchObject({ root_cause: 'UNKNOWN', intervention_strategy: 'ESCALATE_HUMAN' });
  });

  it('selects the fast model and validates every fixture with the request schema', async () => {
    const schema = z.object({ summary: z.string() });
    const result = await new StubLlmClient({ model: 'fixture-default', modelFast: 'fixture-fast' }).completeJson({
      purpose: 'summarize_query_result',
      system: 'Return JSON.',
      user: 'summarize',
      schema,
      tier: 'fast',
    });
    expect(result.model).toBe('fixture-fast');
    expect(result.data).toEqual({ summary: 'The query returned a deterministic fixture result.' });
  });

  it('fails closed when an injected fixture does not satisfy the schema', async () => {
    const client = new StubLlmClient({ fixtureFor: () => ({ wrong: true }) });
    const completion = client.completeJson(diagnosisRequest('payment_authentication'));
    await expect(completion).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(completion).rejects.toThrow(/stub_invalid_fixture/);
  });
});
