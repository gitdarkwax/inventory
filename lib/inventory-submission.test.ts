import { describe, expect, it } from 'vitest';
import {
  aggregateUpdateQuantitiesBySku,
  buildInventorySubmissionUpdates,
} from './inventory-submission';

describe('buildInventorySubmissionUpdates', () => {
  it('keeps canonical sku when split variants are expanded', () => {
    const updates = buildInventorySubmissionUpdates({
      items: [
        {
          sku: 'MBT3Y-DG',
          inventoryItemId: 'fallback',
          variantInventoryItems: [
            { inventoryItemId: 'inv-model-3', variantTitle: 'Model 3 / Left Hand' },
            { inventoryItemId: 'inv-model-y', variantTitle: 'Model Y / Left Hand' },
          ],
        },
      ],
      countsBySku: { 'MBT3Y-DG': 10 },
      locationId: '12345',
    });

    expect(updates).toEqual([
      {
        sku: 'MBT3Y-DG',
        inventoryItemId: 'inv-model-3',
        quantity: 4,
        locationId: '12345',
      },
      {
        sku: 'MBT3Y-DG',
        inventoryItemId: 'inv-model-y',
        quantity: 6,
        locationId: '12345',
      },
    ]);
  });
});

describe('aggregateUpdateQuantitiesBySku', () => {
  it('sums split updates into a single sku total', () => {
    const aggregated = aggregateUpdateQuantitiesBySku([
      { sku: 'MBT3Y-DG', inventoryItemId: 'inv-model-3', quantity: 4, locationId: '12345' },
      { sku: 'MBT3Y-DG', inventoryItemId: 'inv-model-y', quantity: 6, locationId: '12345' },
      { sku: 'MBTCT-DG', inventoryItemId: 'inv-ct', quantity: 3, locationId: '12345' },
    ]);

    expect(aggregated.get('MBT3Y-DG')).toBe(10);
    expect(aggregated.get('MBTCT-DG')).toBe(3);
  });
});
