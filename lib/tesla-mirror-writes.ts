import { getTeslaFixedSkus, getTeslaFixedVariantIdForSku } from './tesla-fixed-variants';

const TESLA_VARIANT_WITH_SIBLINGS_QUERY = `
  query TeslaVariantWithSiblings($variantId: ID!) {
    productVariant(id: $variantId) {
      id
      sku
      inventoryItem {
        id
      }
      product {
        variants(first: 100) {
          nodes {
            id
            sku
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

function normalizeInventoryItemId(id: string): string {
  return id.replace(/^gid:\/\/shopify\/InventoryItem\//, '').trim();
}

function toVariantGid(variantId: string): string {
  return `gid://shopify/ProductVariant/${variantId}`;
}

/**
 * Resolve all inventory item IDs that share each pinned Tesla SKU.
 * These IDs are used to mirror inventory writes to both Model 3 + Model Y.
 */
export async function fetchTeslaMirrorInventoryItemIds(params: {
  shop: string;
  accessToken: string;
}): Promise<Map<string, string[]>> {
  const { shop, accessToken } = params;
  const graphqlUrl = `https://${shop}/admin/api/2024-10/graphql.json`;
  const skuToInventoryItems = new Map<string, Set<string>>();

  for (const sku of getTeslaFixedSkus()) {
    const fixedVariantId = getTeslaFixedVariantIdForSku(sku);
    if (!fixedVariantId) {
      continue;
    }

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: TESLA_VARIANT_WITH_SIBLINGS_QUERY,
        variables: {
          variantId: toVariantGid(fixedVariantId),
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed Tesla variant lookup for ${sku}: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    if (data.errors) {
      throw new Error(`GraphQL lookup failed for ${sku}: ${JSON.stringify(data.errors)}`);
    }

    const variantNode = data.data?.productVariant;
    if (!variantNode) {
      continue;
    }

    const inventoryItemsForSku = skuToInventoryItems.get(sku) || new Set<string>();

    const variantInventoryItemId = variantNode.inventoryItem?.id;
    if (typeof variantInventoryItemId === 'string' && variantInventoryItemId) {
      inventoryItemsForSku.add(normalizeInventoryItemId(variantInventoryItemId));
    }

    const siblingVariants = variantNode.product?.variants?.nodes || [];
    for (const sibling of siblingVariants) {
      if (String(sibling?.sku || '').trim().toUpperCase() !== sku) {
        continue;
      }
      const siblingInventoryItemId = sibling?.inventoryItem?.id;
      if (typeof siblingInventoryItemId === 'string' && siblingInventoryItemId) {
        inventoryItemsForSku.add(normalizeInventoryItemId(siblingInventoryItemId));
      }
    }

    if (inventoryItemsForSku.size > 0) {
      skuToInventoryItems.set(sku, inventoryItemsForSku);
    }
  }

  const resolved = new Map<string, string[]>();
  for (const [sku, inventoryItemIds] of skuToInventoryItems) {
    resolved.set(sku, Array.from(inventoryItemIds));
  }

  return resolved;
}
