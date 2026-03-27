/**
 * Tesla Charger SKUs that must map to one explicit Shopify variant.
 * These SKUs are duplicated across multiple variants/products in Shopify.
 */

const TESLA_FIXED_VARIANT_IDS: Record<string, string> = {
  'MBT3Y-DG': '42054672449617',
  'MBT3YRH-DG': '42054672482385',
};

function normalizeShopifyNumericId(id: string | number): string {
  return String(id).replace(/^gid:\/\/shopify\/ProductVariant\//, '').trim();
}

export function getTeslaFixedVariantIdForSku(sku: string): string | undefined {
  return TESLA_FIXED_VARIANT_IDS[sku.trim().toUpperCase()];
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
