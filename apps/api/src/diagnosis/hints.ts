import type { RazorpayWebhook } from '@aegis/shared';
import type { EntitySnapshot } from '../orchestrator/entity';
import type { Hints } from './schema';
export type { Hints } from './schema';

/**
 * Deterministic signals sent to the diagnosis prompt.
 * Intent: structured projection facts, rather than model output, decide the fields that can be derived reliably.
 * Flow: select the entity row and payload entity -> normalize nullable fields -> classify the paise amount band.
 */
export interface HintEntitySnapshot extends EntitySnapshot {
  readonly type: 'payment' | 'subscription';
}

/** Amount thresholds are expressed in paise because projection rows store integer paise. */
export const AMOUNT_BANDS = Object.freeze({
  microBelowPaise: 50_000,
  smallBelowPaise: 500_000,
  mediumBelowPaise: 5_000_000,
});

function recordValue(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function payloadEntity(payload: RazorpayWebhook, type: 'payment' | 'subscription'): Record<string, unknown> {
  const envelope = (payload.payload as unknown as Record<string, unknown>)[type];
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return {};
  const entity = (envelope as Record<string, unknown>).entity;
  if (typeof entity !== 'object' || entity === null || Array.isArray(entity)) return {};
  return entity as Record<string, unknown>;
}

function field(row: Record<string, unknown>, provider: Record<string, unknown>, key: string): unknown {
  const rowValue = recordValue(row, key);
  return rowValue === undefined ? recordValue(provider, key) : rowValue;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

function safePaise(value: unknown): number {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.min(amount, Number.MAX_SAFE_INTEGER);
}

function amountBand(amountPaise: number): Hints['amount_band'] {
  if (amountPaise < AMOUNT_BANDS.microBelowPaise) return 'micro';
  if (amountPaise < AMOUNT_BANDS.smallBelowPaise) return 'small';
  if (amountPaise < AMOUNT_BANDS.mediumBelowPaise) return 'medium';
  return 'large';
}

function priorFailureCount(value: number | string | null | undefined): number {
  const count = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
}

/**
 * Derive all diagnosis hints without making an LLM or database call.
 * `priorFailures24h` is intentionally supplied by the repository/caller: this module does not guess history.
 */
export function deriveHints(
  payload: RazorpayWebhook,
  entity: EntitySnapshot,
  priorFailures24h: number | string | null | undefined = 0,
): Hints {
  if (entity.type !== 'payment' && entity.type !== 'subscription') {
    throw new Error(`diagnosis hints do not support entity ${entity.type}`);
  }
  const row = entity.row as Record<string, unknown>;
  const provider = payloadEntity(payload, entity.type);
  const customerLocale = typeof entity.customer?.locale === 'string' && entity.customer.locale.trim().length > 0
    ? entity.customer.locale.trim()
    : 'en-IN';
  const amount = field(row, provider, 'amount_paise') ?? field(row, provider, 'amount');

  return {
    entity: entity.type,
    is_international: booleanValue(field(row, provider, 'international')),
    method: nullableString(field(row, provider, 'method')),
    error_step: nullableString(field(row, provider, 'error_step')),
    error_reason: nullableString(field(row, provider, 'error_reason')),
    error_source: nullableString(field(row, provider, 'error_source')),
    amount_band: amountBand(safePaise(amount)),
    customer_locale: customerLocale,
    prior_failures_24h: priorFailureCount(priorFailures24h),
  };
}
