export const SALVAGE_STATES = ['none', 'retry_scheduled', 'retrying', 'offer_sent', 'recovered', 'churned', 'escalated'] as const;
export type SalvageState = (typeof SALVAGE_STATES)[number];
export const SALVAGE_EVENTS = ['failure_observed', 'retry_due', 'retry_failed', 'payment_succeeded', 'max_retries_reached', 'escalate'] as const;
export type SalvageEvent = (typeof SALVAGE_EVENTS)[number];

/**
 * Exhaustive dunning transition table.
 * Intent: retries are a finite state machine, never an LLM decision or an unbounded loop.
 * Flow: terminal check (with the documented churn recovery exception) -> escalation -> state/event lookup; null means
 *       the event is invalid for the current state and must not mutate the subscription.
 *
 * | state(s)                         | event                  | next              |
 * | none                             | failure_observed       | retry_scheduled    |
 * | retry_scheduled                  | retry_due              | retrying           |
 * | retrying                         | retry_failed           | retry_scheduled/churned (count < max)
 * | retry_scheduled/retrying/offer_sent | payment_succeeded | recovered          |
 * | any non-terminal                 | escalate               | escalated          |
 * | churned                          | payment_succeeded      | recovered (late payment exception)
 */
export function nextSalvageState(current: SalvageState, event: SalvageEvent, retryCount: number, maxRetries: number): SalvageState | null {
  if (!Number.isSafeInteger(retryCount) || !Number.isSafeInteger(maxRetries) || retryCount < 0 || maxRetries < 0) return null;
  if (current === 'churned' && event === 'payment_succeeded') return 'recovered';
  if (current === 'recovered' || current === 'churned' || current === 'escalated') return null;
  if (event === 'escalate') return 'escalated';
  switch (current) {
    case 'none': return event === 'failure_observed' ? 'retry_scheduled' : null;
    case 'retry_scheduled':
      if (event === 'retry_due') return 'retrying';
      if (event === 'payment_succeeded') return 'recovered';
      return null;
    case 'retrying':
      if (event === 'retry_failed') return retryCount < maxRetries ? 'retry_scheduled' : 'churned';
      if (event === 'payment_succeeded') return 'recovered';
      return null;
    case 'offer_sent': return event === 'payment_succeeded' ? 'recovered' : null;
  }
}

