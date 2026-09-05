/**
 * Mask contact data before it is handed to a model. These helpers deliberately return stable, readable values so
 * prompts remain useful for diagnosis without exposing a complete address or phone number (C-A7).
 */

const COUNTRY_PREFIXES = ['+971', '+91', '+44', '+65', '+1'] as const;

export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return value.length === 0 ? value : `${value[0] ?? ''}••••`;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${local[0] ?? ''}••••@${domain}`;
}

export function maskContact(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;

  const prefix = COUNTRY_PREFIXES.find((candidate) => trimmed.startsWith(candidate)) ?? (trimmed.startsWith('+') ? '+' : '');
  const suffixSource = prefix.length > 0 ? trimmed.slice(prefix.length) : trimmed;
  const suffix = suffixSource.slice(-4);
  const hiddenLength = Math.max(0, suffixSource.length - suffix.length);
  return `${prefix}${'•'.repeat(hiddenLength)}${suffix}`;
}

function maskName(value: string): string {
  const first = value.trim().slice(0, 1);
  return first.length === 0 ? '' : `${first}••••`;
}

function maskDigits(value: string): string {
  if (value.length <= 4) return '•'.repeat(value.length);
  const suffix = value.slice(-4);
  return `${'•'.repeat(value.length - suffix.length)}${suffix}`;
}

function maskKeyValue(key: string, value: unknown): unknown {
  const normalized = key.toLowerCase().replace(/[._-]/g, '');
  // Intent: provider payloads can nest card details as `{ card: { number, cvv, expiry_* } }`, which a root-key-only
  // matcher would leak to the model. Mask all card-number/security fields regardless of whether the provider sends a
  // string or numeric value; preserving only the final four digits keeps the prompt useful without exposing PII.
  // Flow: identify the sensitive card field -> stringify primitive -> hide every digit except its last four -> recurse
  // for structured values so a future provider shape remains masked as well.
  if (
    normalized === 'number'
    || normalized === 'cvv'
    || normalized === 'cvc'
    || normalized === 'securitycode'
    || normalized === 'expiry'
    || normalized === 'expirymonth'
    || normalized === 'expiryyear'
    || normalized === 'cardnumber'
  ) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
      return maskDigits(String(value));
    }
    return maskPii(value);
  }
  if (typeof value === 'string') {
    if (normalized.includes('email')) return maskEmail(value);
    if (normalized.includes('contact') || normalized.includes('phone')) return maskContact(value);
    if (normalized === 'name' || normalized.endsWith('fullname')) return maskName(value);
  }
  if (typeof value !== 'string') return maskPii(value);
  return value;
}

/**
 * Recursively copy a JSON-like value while masking known PII fields. The source object is never mutated, which keeps
 * the original provider payload available for persistence and audit after the prompt has been built.
 */
export function maskPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => maskPii(item));
  // Projection rows arrive straight from node-postgres, so `timestamptz` columns are `Date` instances. Recursing into
  // one yields no own enumerable entries and would serialize every timestamp in the prompt as `{}`, silently dropping
  // the failure timing a diagnosis depends on. Dates carry no PII, so they are passed through to their ISO form.
  if (value instanceof Date) return value;
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, maskKeyValue(key, item)]));
}
