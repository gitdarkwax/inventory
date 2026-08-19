/**
 * Tesla Charger SKUs that must map to one explicit Shopify variant.
 * These SKUs are duplicated across multiple variants/products in Shopify —
 * writes are mirrored to every sibling inventory item that shares the SKU
 * (see lib/tesla-mirror-writes.ts).
 *
 * The pinned variant is always the Model Y one (canonical for display and
 * cache lookups); mirror writes propagate to Model 3 siblings on the same
 * product.
 */

const TESLA_FIXED_VARIANTS: Record<string, { variantId: string; preferredVariantTitle: string }> = {
  // MBT product (MagBak Charger for Tesla — first-gen)
  'MBT3Y-DG': {
    variantId: '42054672449617',
    preferredVariantTitle: 'Model Y / 2020-2024 / Left Hand',
  },
  'MBT3YRH-DG': {
    variantId: '42054672482385',
    preferredVariantTitle: 'Model Y / 2020-2024 / Right Hand',
  },
  // Q2T product (MagBak Phone Mount And Charger for Tesla — product 15727432826961)
  // Each of these SKUs lives on both a Model Y variant and a Model 3 variant.
  'Q2T15': {
    variantId: '59208702623825',
    preferredVariantTitle: 'Model Y / 2025+ 15.4" Screen / Left',
  },
  'Q2T15RH': {
    variantId: '59208702656593',
    preferredVariantTitle: 'Model Y / 2025+ 15.4" Screen / Right',
  },
  'Q2TOG': {
    variantId: '59208702296145',
    preferredVariantTitle: 'Model Y / 2020-2024 / Left',
  },
  'Q2TOGRH': {
    variantId: '59208702328913',
    preferredVariantTitle: 'Model Y / 2020-2024 / Right',
  },
};

function normalizeShopifyNumericId(id: string | number): string {
  return String(id).replace(/^gid:\/\/shopify\/ProductVariant\//, '').trim();
}

export function getTeslaFixedSkus(): string[] {
  return Object.keys(TESLA_FIXED_VARIANTS);
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
