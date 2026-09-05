import type pg from 'pg';
import { countryFromContact, localeFor } from '@aegis/shared';

export interface CustomerPayload {
  readonly customer_id?: string | null;
  readonly customerId?: string | null;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly contact?: string | null;
  readonly notes?: Record<string, unknown> | null;
}

export interface CustomerRow {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly contact: string | null;
  readonly country: string | null;
  readonly locale: string;
  readonly opted_out: boolean;
  readonly notes: Record<string, unknown>;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function notesLocale(notes: Record<string, unknown> | null | undefined): string | null {
  const locale = notes?.locale;
  return typeof locale === 'string' && locale.trim().length > 0 ? locale : null;
}

/**
 * Upsert provider customer facts while retaining merchant-owned preferences.
 * Intent: customer rows are the parent of several projections, so one deterministic upsert prevents FK races and
 *         keeps opted-out state owned by the merchant rather than overwritten by a webhook.
 * Flow: validate id -> derive country/locale -> insert or merge provider fields -> return the committed row.
 */
export async function upsertCustomerFromPayload(tx: pg.PoolClient, input: CustomerPayload): Promise<CustomerRow | null> {
  const id = input.customer_id ?? input.customerId ?? null;
  if (id === null || id.trim().length === 0) return null;

  const contact = input.contact ?? null;
  const country = countryFromContact(contact);
  const explicitLocale = notesLocale(input.notes);
  const locale = localeFor(country, explicitLocale);
  const notes = input.notes ?? {};

  const result = await tx.query<CustomerRow>(
    `INSERT INTO customers (id, name, email, contact, country, locale, opted_out, notes)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, customers.name),
       email = COALESCE(EXCLUDED.email, customers.email),
       contact = COALESCE(EXCLUDED.contact, customers.contact),
       country = CASE WHEN $8::boolean THEN EXCLUDED.country ELSE customers.country END,
       locale = CASE WHEN $9::boolean THEN EXCLUDED.locale ELSE customers.locale END,
       notes = customers.notes || EXCLUDED.notes,
       updated_at = now()
     RETURNING id, name, email, contact, country, locale, opted_out, notes, created_at, updated_at`,
    [id, input.name ?? null, input.email ?? null, contact, country, locale, JSON.stringify(notes), contact !== null, explicitLocale !== null],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`customer upsert returned no row for ${id}`);
  return row;
}
