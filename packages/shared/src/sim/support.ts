import { RazorpayWebhookSchema, type RazorpayWebhook } from '../razorpay/webhook';
import { createIdFactory, type SimIdFactory } from './ids';
import {
  DEFAULT_SIM_ACCOUNT_ID,
  DEFAULT_SIM_CREATED_AT,
  type BuildWebhookInput,
  type ScenarioBuildOptions,
  type SimScenario,
  type SimScenarioAttribution,
} from './types';

/**
 * Build and validate the provider envelope shared by every simulator scenario.
 * Intent: signing and HTTP transport must receive one exact object shape, not a scenario-specific approximation.
 * Flow: construct the envelope -> parse it through the shared zod schema -> return the typed passthrough payload.
 */
export function buildWebhook(input: BuildWebhookInput): RazorpayWebhook {
  return RazorpayWebhookSchema.parse({
    entity: 'event',
    account_id: input.accountId,
    event: input.event,
    contains: [input.entityKey],
    payload: { [input.entityKey]: { entity: input.entity } },
    created_at: input.createdAt,
  });
}

export function idsFor(options: ScenarioBuildOptions): SimIdFactory {
  return options.ids ?? createIdFactory(options.seed);
}

export function accountFor(options: ScenarioBuildOptions): string {
  return options.accountId ?? DEFAULT_SIM_ACCOUNT_ID;
}

export function createdAtFor(options: ScenarioBuildOptions): number {
  return options.createdAt ?? DEFAULT_SIM_CREATED_AT;
}

export function customerFor(options: ScenarioBuildOptions, ids: SimIdFactory): string {
  return options.customerId ?? ids.customerId();
}

// Intent: attach one unique provider event id to an already validated entity fixture.
// Flow: allocate event id -> build exact envelope -> return transport metadata, including forged-signature state.
export function makeScenario(
  name: SimScenario['name'],
  event: string,
  entityKey: string,
  entity: Record<string, unknown>,
  options: ScenarioBuildOptions,
  signatureValid = true,
  attribution?: SimScenarioAttribution,
): SimScenario {
  const ids = idsFor(options);
  const eventId = ids.eventId();
  const webhook = buildWebhook({
    event,
    entityKey,
    entity,
    accountId: accountFor(options),
    createdAt: createdAtFor(options),
  });
  return {
    name,
    eventId,
    entityKey,
    webhook,
    signatureValid,
    ...(attribution ? { attribution } : {}),
  };
}

// Intent: let the aggregate builder carry ids between related lifecycle events without unsafe schema casts.
// Flow: locate the wrapper -> narrow its entity to an object -> read only string fields used for attribution.
export function entityString(scenario: SimScenario, key: string, field: string): string | undefined {
  const wrapped = Object.entries(scenario.webhook.payload).find(([entryKey]) => entryKey === key)?.[1];
  if (typeof wrapped !== 'object' || wrapped === null || !('entity' in wrapped)) return undefined;
  const entity = wrapped.entity;
  if (typeof entity !== 'object' || entity === null || !(field in entity)) return undefined;
  const value = Object.entries(entity).find(([entryKey]) => entryKey === field)?.[1];
  return typeof value === 'string' ? value : undefined;
}

export function at(options: ScenarioBuildOptions, offset: number): ScenarioBuildOptions {
  return { ...options, createdAt: createdAtFor(options) + offset };
}
