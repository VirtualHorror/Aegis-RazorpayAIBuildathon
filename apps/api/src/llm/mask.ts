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

function maskKeyValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return maskPii(value);
  const normalized = key.toLowerCase().replace(/[._-]/g, '');
  if (normalized.includes('email')) return maskEmail(value);
  if (normalized.includes('contact') || normalized.includes('phone') || normalized === 'cardnumber') return maskContact(value);
  if (normalized === 'name' || normalized.endsWith('fullname')) return maskName(value);
  return value;
}

/**
 * Recursively copy a JSON-like value while masking known PII fields. The source object is never mutated, which keeps
 * the original provider payload available for persistence and audit after the prompt has been built.
 */
export function maskPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => maskPii(item));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, maskKeyValue(key, item)]));
}
