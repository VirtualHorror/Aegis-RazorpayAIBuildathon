import { describe, expect, it } from 'vitest';
import { prescreen } from './keywords';

describe('compliance keyword prescreen', () => {
  it('returns category and matched pattern without model calls', () => {
    expect(prescreen('Promises guaranteed returns')).toContainEqual({ category: 'financial_guarantees_mlm', pattern: 'guaranteed returns' });
    expect(prescreen('nicotine vape starter pack')).toEqual(expect.arrayContaining([{ category: 'tobacco_vape', pattern: 'vape' }, { category: 'tobacco_vape', pattern: 'nicotine' }]));
  });
});
