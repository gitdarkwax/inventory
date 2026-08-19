import { describe, expect, it } from 'vitest';
import {
  getTeslaFixedVariantIdForSku,
  getTeslaPreferredVariantTitleForSku,
  matchesTeslaFixedVariant,
} from './tesla-fixed-variants';

describe('tesla-fixed-variants', () => {
  it('returns fixed variant IDs for pinned MBT SKUs', () => {
    expect(getTeslaFixedVariantIdForSku('MBT3Y-DG')).toBe('42054672449617');
    expect(getTeslaFixedVariantIdForSku('MBT3YRH-DG')).toBe('42054672482385');
  });

  it('returns fixed variant IDs for pinned Q2T SKUs', () => {
    expect(getTeslaFixedVariantIdForSku('Q2T15')).toBe('59208702623825');
    expect(getTeslaFixedVariantIdForSku('Q2T15RH')).toBe('59208702656593');
    expect(getTeslaFixedVariantIdForSku('Q2TOG')).toBe('59208702296145');
    expect(getTeslaFixedVariantIdForSku('Q2TOGRH')).toBe('59208702328913');
  });

  it('returns preferred Model Y variant titles', () => {
    expect(getTeslaPreferredVariantTitleForSku('MBT3Y-DG')).toBe('Model Y / 2020-2024 / Left Hand');
    expect(getTeslaPreferredVariantTitleForSku('MBT3YRH-DG')).toBe('Model Y / 2020-2024 / Right Hand');
    expect(getTeslaPreferredVariantTitleForSku('Q2T15')).toBe('Model Y / 2025+ 15.4" Screen / Left');
    expect(getTeslaPreferredVariantTitleForSku('Q2TOGRH')).toBe('Model Y / 2020-2024 / Right');
  });

  it('matches only the pinned variant ID for each SKU', () => {
    expect(matchesTeslaFixedVariant('MBT3Y-DG', '42054672449617')).toBe(true);
    expect(matchesTeslaFixedVariant('MBT3Y-DG', '42054672482385')).toBe(false);
    expect(matchesTeslaFixedVariant('MBT3YRH-DG', '42054672482385')).toBe(true);
    expect(matchesTeslaFixedVariant('MBT3YRH-DG', '42054672449617')).toBe(false);
    // Q2T pins target the Model Y variant; Model 3 sibling on same product returns false
    expect(matchesTeslaFixedVariant('Q2T15', '59208702623825')).toBe(true);
    expect(matchesTeslaFixedVariant('Q2T15', '59208702885969')).toBe(false); // Model 3 sibling
    expect(matchesTeslaFixedVariant('Q2TOG', '59208702296145')).toBe(true);
    expect(matchesTeslaFixedVariant('Q2TOG', '59208702820433')).toBe(false); // Model 3 sibling
  });
});
