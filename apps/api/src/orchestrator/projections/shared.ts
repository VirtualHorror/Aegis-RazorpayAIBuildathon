import type pg from 'pg';
import type {
  RazorpayDisputeEntity,
  RazorpayInvoiceEntity,
  RazorpayOrderEntity,
  RazorpayPaymentEntity,
  RazorpaySubscriptionEntity,
  RazorpayWebhook,
} from '@aegis/shared';
import { upsertCustomerFromPayload, type CustomerPayload, type CustomerRow } from '../../db/repos/customers';
import type { EntitySnapshot, ProjectionRow } from '../entity';

export interface ProjectionContext {
  readonly eventId?: string | null;
  /** Alias used by the worker's webhook row context. */
  readonly eventAt?: Date | null;
  readonly eventCreatedAt?: Date | null;
}

export type ProjectionEntity =
  | RazorpayPaymentEntity
  | RazorpayOrderEntity
  | RazorpaySubscriptionEntity
  | RazorpayInvoiceEntity
  | RazorpayDisputeEntity;

export function asContext(context: ProjectionContext | string | null | undefined): ProjectionContext {
  if (typeof context === 'string') return { eventId: context };
  return context ?? {};
}

/** Convert Razorpay's seconds, milliseconds, or ISO timestamp into a Date. */
export function eventDate(payload: RazorpayWebhook, context: ProjectionContext): Date {
  const candidate = context.eventAt ?? context.eventCreatedAt ?? dateFromUnknown(payload.created_at);
  return candidate ?? new Date(0);
}

export function dateFromUnknown(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 100_000_000_000 ? value * 1_000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return dateFromUnknown(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function entityCreatedAt(entity: ProjectionEntity): Date | null {
  const value = (entity as ProjectionEntity & { created_at?: unknown }).created_at;
  return dateFromUnknown(value);
}

export function nullableDate(value: number | null | undefined): Date | null {
  return value === null || value === undefined ? null : dateFromUnknown(value);
}

export function asEntity(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} entity is missing`);
  return value as Record<string, unknown>;
}

export function customerInput(entity: ProjectionEntity): CustomerPayload {
  const record = entity as Record<string, unknown>;
  const notesValue = record.notes;
  const notes = typeof notesValue === 'object' && notesValue !== null && !Array.isArray(notesValue)
    ? notesValue as Record<string, unknown>
    : undefined;
  const customerIdValue = record.customer_id;
  const emailValue = record.email;
  const contactValue = record.contact;
  return {
    customer_id: typeof customerIdValue === 'string' ? customerIdValue : customerIdValue === null ? null : undefined,
    email: typeof emailValue === 'string' ? emailValue : emailValue === null ? null : undefined,
    contact: typeof contactValue === 'string' ? contactValue : contactValue === null ? null : undefined,
    notes,
  };
}

export async function projectCustomer(tx: pg.PoolClient, entity: ProjectionEntity): Promise<CustomerRow | null> {
  return upsertCustomerFromPayload(tx, customerInput(entity));
}

export async function loadCustomer(tx: pg.PoolClient, customerId: string | null): Promise<CustomerRow | null> {
  if (customerId === null) return null;
  const result = await tx.query<CustomerRow>(
    `SELECT id, name, email, contact, country, locale, opted_out, notes, created_at, updated_at
     FROM customers WHERE id = $1`,
    [customerId],
  );
  return result.rows[0] ?? null;
}

/** Preserve an existing value when a provider sends a partial entity, including explicit nulls. */
export function definedOr<T>(incoming: T | undefined, current: T | null | undefined, fallback: T): T {
  return incoming === undefined ? current ?? fallback : incoming;
}

export function objectOrEmpty(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ?? {};
}

export function arrayOrEmpty(value: readonly unknown[] | undefined): readonly unknown[] {
  return value ?? [];
}

export function sourceEventId(context: ProjectionContext, current: string | null | undefined): string | null {
  return context.eventId ?? current ?? null;
}

export function sameEvent(current: ProjectionRow | undefined, context: ProjectionContext): boolean {
  return context.eventId !== undefined && context.eventId !== null && current?.last_event_id === context.eventId;
}

export function snapshot<T extends ProjectionRow>(type: EntitySnapshot['type'], row: T, customer: CustomerRow | null, applied: boolean): EntitySnapshot {
  return { type, row, customer, applied };
}
