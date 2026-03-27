import { describe, expect, it } from 'vitest';
import {
  getTeslaFixedVariantIdForSku,
  getTeslaPreferredVariantTitleForSku,
  matchesTeslaFixedVariant,
} from './tesla-fixed-variants';

describe('tesla-fixed-variants', () => {
  it('returns fixed variant IDs for pinned Tesla SKUs', () => {
    expect(getTeslaFixedVariantIdForSku('MBT3Y-DG')).toBe('42054672449617');
    expect(getTeslaFixedVariantIdForSku('MBT3YRH-DG')).toBe('42054672482385');
  });

  it('returns preferred Model Y variant titles', () => {
    expect(getTeslaPreferredVariantTitleForSku('MBT3Y-DG')).toBe('Model Y / 2020-2024 / Left Hand');
    expect(getTeslaPreferredVariantTitleForSku('MBT3YRH-DG')).toBe('Model Y / 2020-2024 / Right Hand');
  });

  it('matches only the pinned variant ID for each SKU', () => {
    expect(matchesTeslaFixedVariant('MBT3Y-DG', '42054672449617')).toBe(true);
    expect(matchesTeslaFixedVariant('MBT3Y-DG', '42054672482385')).toBe(false);
    expect(matchesTeslaFixedVariant('MBT3YRH-DG', '42054672482385')).toBe(true);
    expect(matchesTeslaFixedVariant('MBT3YRH-DG', '42054672449617')).toBe(false);
  });
});
