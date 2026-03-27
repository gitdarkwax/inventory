/**
 * Tesla Charger SKUs that must map to one explicit Shopify variant.
 * These SKUs are duplicated across multiple variants/products in Shopify.
 */

const TESLA_FIXED_VARIANTS: Record<string, { variantId: string; preferredVariantTitle: string }> = {
  'MBT3Y-DG': {
    variantId: '42054672449617',
    preferredVariantTitle: 'Model Y / 2020-2024 / Left Hand',
  },
  'MBT3YRH-DG': {
    variantId: '42054672482385',
    preferredVariantTitle: 'Model Y / 2020-2024 / Right Hand',
  },
};

function normalizeShopifyNumericId(id: string | number): string {
  return String(id).replace(/^gid:\/\/shopify\/ProductVariant\//, '').trim();
}

export function getTeslaFixedVariantIdForSku(sku: string): string | undefined {
  return TESLA_FIXED_VARIANTS[sku.trim().toUpperCase()]?.variantId;
}

export function getTeslaPreferredVariantTitleForSku(sku: string): string | undefined {
  return TESLA_FIXED_VARIANTS[sku.trim().toUpperCase()]?.preferredVariantTitle;
}

export function isTeslaFixedVariantSku(sku: string): boolean {
  return Boolean(getTeslaFixedVariantIdForSku(sku));
}

export function matchesTeslaFixedVariant(sku: string, variantId: string | number): boolean {
  const expectedVariantId = getTeslaFixedVariantIdForSku(sku);
  if (!expectedVariantId) {
    return true;
  }

  return normalizeShopifyNumericId(variantId) === normalizeShopifyNumericId(expectedVariantId);
}
