/**
 * Helpers for preparing inventory count submission payloads.
 * Keeps canonical SKU mapping stable for Shopify validation.
 */

export interface VariantInventoryItemForSubmission {
  inventoryItemId: string;
  variantTitle: string;
}

export interface InventoryCountSubmissionItem {
  sku: string;
  inventoryItemId: string;
  variantInventoryItems?: VariantInventoryItemForSubmission[];
}

export interface MultiVariantSkuSplitAllocation {
  variantMatch: string;
  percentage: number;
}

export interface MultiVariantSkuSplitConfig {
  sku: string;
  allocations: MultiVariantSkuSplitAllocation[];
}

export interface InventoryUpdatePayload {
  sku: string;
  inventoryItemId: string;
  quantity: number;
  locationId: string;
}

export const DEFAULT_MULTI_VARIANT_SKU_SPLITS: ReadonlyArray<MultiVariantSkuSplitConfig> = [
  {
    sku: 'MBT3Y-DG',
    allocations: [
      { variantMatch: 'Model 3', percentage: 0.35 },
      { variantMatch: 'Model Y', percentage: 0.65 },
    ],
  },
  {
    sku: 'MBT3YRH-DG',
    allocations: [
      { variantMatch: 'Model 3', percentage: 0.35 },
      { variantMatch: 'Model Y', percentage: 0.65 },
    ],
  },
];

/**
 * Builds Shopify inventory updates from counted SKU quantities.
 * Split SKUs are expanded by inventory item, but keep canonical SKU labels.
 */
export function buildInventorySubmissionUpdates(params: {
  items: InventoryCountSubmissionItem[];
  countsBySku: Record<string, number | null | undefined>;
  locationId: string;
  splitConfigs?: ReadonlyArray<MultiVariantSkuSplitConfig>;
}): InventoryUpdatePayload[] {
  const { items, countsBySku, locationId, splitConfigs = DEFAULT_MULTI_VARIANT_SKU_SPLITS } = params;
  const updates: InventoryUpdatePayload[] = [];

  for (const item of items) {
    const quantity = countsBySku[item.sku] ?? 0;
    const splitConfig = splitConfigs.find((config) => config.sku === item.sku);

    if (splitConfig && item.variantInventoryItems && item.variantInventoryItems.length > 1) {
      let remainingQuantity = quantity;

      for (let index = 0; index < splitConfig.allocations.length; index++) {
        const allocation = splitConfig.allocations[index];
        const variant = item.variantInventoryItems.find((candidate) =>
          candidate.variantTitle.includes(allocation.variantMatch)
        );

        if (!variant) {
          continue;
        }

        const allocatedQuantity =
          index === splitConfig.allocations.length - 1
            ? remainingQuantity
            : Math.round(quantity * allocation.percentage);

        updates.push({
          sku: item.sku,
          inventoryItemId: variant.inventoryItemId,
          quantity: allocatedQuantity,
          locationId,
        });

        remainingQuantity -= allocatedQuantity;
      }

      continue;
    }

    updates.push({
      sku: item.sku,
      inventoryItemId: item.inventoryItemId,
      quantity,
      locationId,
    });
  }

  return updates;
}

/**
 * Aggregates per-update quantities into one quantity per canonical SKU.
 */
export function aggregateUpdateQuantitiesBySku(
  updates: ReadonlyArray<InventoryUpdatePayload>
): Map<string, number> {
  const quantityBySku = new Map<string, number>();

  for (const update of updates) {
    const currentQuantity = quantityBySku.get(update.sku) || 0;
    quantityBySku.set(update.sku, currentQuantity + update.quantity);
  }

  return quantityBySku;
}
