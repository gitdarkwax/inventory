import { describe, expect, it } from 'vitest';
import { parseWholeNumber, validateInventoryUpdates, validateMovedItems } from './request-validation';

describe('parseWholeNumber', () => {
  it('accepts whole numbers and whole-number strings', () => {
    expect(parseWholeNumber(12)).toBe(12);
    expect(parseWholeNumber(0)).toBe(0);
    expect(parseWholeNumber(-3)).toBe(-3);
    expect(parseWholeNumber(' 40 ')).toBe(40);
  });

  it('rejects fractions, blanks and non-numbers', () => {
    expect(parseWholeNumber(1.5)).toBeNull();
    expect(parseWholeNumber('1.5')).toBeNull();
    expect(parseWholeNumber('')).toBeNull();
    expect(parseWholeNumber(null)).toBeNull();
    expect(parseWholeNumber(undefined)).toBeNull();
    expect(parseWholeNumber(Number.NaN)).toBeNull();
    expect(parseWholeNumber('abc')).toBeNull();
  });
});

describe('validateMovedItems', () => {
  it('passes normal transfer items through, keeping extra fields', () => {
    const result = validateMovedItems([
      { sku: 'MBT3Y-DG', quantity: 24, pallet: 'Pallet 1' },
      { sku: 'EC16', quantity: 0 },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { sku: 'MBT3Y-DG', quantity: 24, pallet: 'Pallet 1' },
        { sku: 'EC16', quantity: 0 },
      ],
    });
  });

  it('turns whole-number strings from older records into numbers', () => {
    const result = validateMovedItems([{ sku: 'EC16', quantity: '10' }]);
    expect(result.ok && result.value[0].quantity).toBe(10);
  });

  it('rejects negative quantities, which would reverse the stock move', () => {
    const result = validateMovedItems([{ sku: 'EC16', quantity: -5 }]);
    expect(result.ok).toBe(false);
  });

  it('rejects fractional quantities, blank SKUs and non-lists', () => {
    expect(validateMovedItems([{ sku: 'EC16', quantity: 2.5 }]).ok).toBe(false);
    expect(validateMovedItems([{ sku: '  ', quantity: 2 }]).ok).toBe(false);
    expect(validateMovedItems([{ quantity: 2 }]).ok).toBe(false);
    expect(validateMovedItems('EC16').ok).toBe(false);
    expect(validateMovedItems(undefined).ok).toBe(false);
  });
});

describe('validateInventoryUpdates', () => {
  const base = { sku: 'EC16', inventoryItemId: '123', locationId: '456' };

  it('accepts count submissions and PO deliveries, including negative on-hand', () => {
    const result = validateInventoryUpdates([
      { ...base, quantity: 30 },
      { ...base, sku: 'EC17', quantity: -2 },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects an empty list, as the route did before', () => {
    expect(validateInventoryUpdates([])).toEqual({ ok: false, error: 'No updates provided' });
    expect(validateInventoryUpdates(undefined)).toEqual({ ok: false, error: 'No updates provided' });
  });

  it('rejects missing SKUs, IDs and non-whole quantities', () => {
    expect(validateInventoryUpdates([{ ...base, sku: undefined, quantity: 1 }]).ok).toBe(false);
    expect(validateInventoryUpdates([{ ...base, inventoryItemId: '', quantity: 1 }]).ok).toBe(false);
    expect(validateInventoryUpdates([{ ...base, locationId: undefined, quantity: 1 }]).ok).toBe(false);
    expect(validateInventoryUpdates([{ ...base, quantity: 1.25 }]).ok).toBe(false);
    expect(validateInventoryUpdates([{ ...base, quantity: 'ten' }]).ok).toBe(false);
  });
});
