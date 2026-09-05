import { describe, expect, it } from 'vitest';
import { countryFromContact, localeFor } from './locale';

describe('countryFromContact', () => {
  it.each([
    ['+91******42', 'IN'],
    ['+1 (212) 555-0100', 'US'],
    ['+44 20 7946 0958', 'GB'],
    ['+971-50-123-4567', 'AE'],
    ['+65 6123 4567', 'SG'],
  ])('maps %s to %s', (contact, country) => {
    expect(countryFromContact(contact)).toBe(country);
  });

  it('returns null for missing and unsupported contacts', () => {
    expect(countryFromContact(null)).toBeNull();
    expect(countryFromContact('+81 3 1234 5678')).toBeNull();
    expect(countryFromContact('not-a-phone')).toBeNull();
  });
});

describe('localeFor', () => {
  it('uses an explicit notes locale before the country default', () => {
    expect(localeFor('IN', 'hi-IN')).toBe('hi-IN');
    expect(localeFor('US', ' en-GB ')).toBe('en-GB');
  });

  it('maps supported countries and defaults unknown values to en-IN', () => {
    expect(localeFor('IN', null)).toBe('en-IN');
    expect(localeFor('US', null)).toBe('en-US');
    expect(localeFor('GB', null)).toBe('en-GB');
    expect(localeFor('AE', null)).toBe('en-AE');
    expect(localeFor('SG', null)).toBe('en-SG');
    expect(localeFor(null, null)).toBe('en-IN');
  });
});
