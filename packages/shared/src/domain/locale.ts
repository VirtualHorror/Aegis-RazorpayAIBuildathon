/**
 * Deterministic country and locale helpers used by projections and customer messaging.
 * Intent: derive a coarse country only from the phone prefix and never ask an LLM to choose a locale.
 * Flow: normalize the provider contact -> match the longest supported prefix -> map country to a default locale.
 */

const COUNTRY_PREFIXES: readonly [prefix: string, country: string][] = [
  ['+971', 'AE'],
  ['+65', 'SG'],
  ['+44', 'GB'],
  ['+91', 'IN'],
  ['+1', 'US'],
];

const DEFAULT_LOCALES: Readonly<Record<string, string>> = {
  IN: 'en-IN',
  US: 'en-US',
  GB: 'en-GB',
  AE: 'en-AE',
  SG: 'en-SG',
};

/** Return the supported ISO country code for a contact, or null when the prefix is unknown. */
export function countryFromContact(contact: string | null): string | null {
  if (contact === null) return null;
  const normalized = contact.replace(/[\s()\-.]/g, '');
  for (const [prefix, country] of COUNTRY_PREFIXES) {
    if (normalized.startsWith(prefix)) return country;
  }
  return null;
}

/**
 * Prefer an explicit provider locale from `notes.locale`; otherwise use the country's stable default.
 * An empty or whitespace-only note is treated as absent. Unknown countries intentionally fall back to en-IN,
 * matching the database column default and keeping downstream templates deterministic.
 */
export function localeFor(country: string | null, notesLocale: string | null): string {
  const explicit = notesLocale?.trim();
  if (explicit) return explicit;
  const normalizedCountry = country?.trim().toUpperCase() ?? '';
  return DEFAULT_LOCALES[normalizedCountry] ?? 'en-IN';
}
