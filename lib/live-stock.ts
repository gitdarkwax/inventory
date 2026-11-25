/**
 * Live On Hand checks against Shopify, used before stock leaves a location.
 *
 * The dashboard's own stock check uses the counts loaded in the browser, which
 * go stale while someone marks several transfers in a row. On 2026-11-25 eleven
 * China WH transfers were marked from one page and ECFLD-BK went to -150.
 * The server re-checks against Shopify right before subtracting.
 */

const ON_HAND_QUERY = `
  query liveOnHand($ids: [ID!]!, $locationId: ID!) {
    nodes(ids: $ids) {
      ... on InventoryItem {
        id
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["on_hand"]) {
            name
            quantity
          }
        }
      }
    }
  }
`;

function itemGid(id: string): string {
  return id.startsWith('gid://') ? id : `gid://shopify/InventoryItem/${id}`;
}

function bareId(id: string): string {
  return id.replace(/^gid:\/\/shopify\/InventoryItem\//, '');
}

/**
 * On Hand per inventory item (bare numeric id) at one location.
 * An item not stocked at the location counts as 0. Throws if Shopify can't be read.
 */
export async function fetchLiveOnHand(
  graphqlUrl: string,
  accessToken: string,
  locationId: string,
  inventoryItemIds: string[]
): Promise<Map<string, number>> {
  const unique = Array.from(new Set(inventoryItemIds.map(id => bareId(String(id)))));
  const result = new Map<string, number>(unique.map(id => [id, 0]));
  const locationGid = locationId.startsWith('gid://') ? locationId : `gid://shopify/Location/${locationId}`;

  for (let i = 0; i < unique.length; i += 100) {
    const ids = unique.slice(i, i + 100).map(itemGid);
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ON_HAND_QUERY, variables: { ids, locationId: locationGid } }),
    });
    if (!response.ok) {
      throw new Error(`Could not read live stock from Shopify (HTTP ${response.status})`);
    }
    const data = await response.json();
    if (data.errors) {
      throw new Error(`Could not read live stock from Shopify: ${JSON.stringify(data.errors)}`);
    }
    for (const node of data.data?.nodes || []) {
      if (!node?.id) continue;
      const onHand = node.inventoryLevel?.quantities?.find((q: { name: string }) => q.name === 'on_hand')?.quantity;
      result.set(bareId(node.id), typeof onHand === 'number' ? onHand : 0);
    }
  }
  return result;
}

export interface StockShortfall {
  sku: string;
  requested: number;
  onHand: number;
}

/**
 * Compares what a transfer takes (summed per SKU, so pallet lines add up)
 * with live On Hand. Returns the SKUs that don't have enough.
 */
export function findShortfalls(
  items: Array<{ sku: string; quantity: number; inventoryItemId: string }>,
  onHandByItem: Map<string, number>
): StockShortfall[] {
  const needed = new Map<string, { sku: string; requested: number; inventoryItemId: string }>();
  for (const item of items) {
    const key = item.sku.trim().toUpperCase();
    const entry = needed.get(key);
    if (entry) entry.requested += item.quantity;
    else needed.set(key, { sku: item.sku, requested: item.quantity, inventoryItemId: bareId(String(item.inventoryItemId)) });
  }
  const shortfalls: StockShortfall[] = [];
  for (const entry of needed.values()) {
    const onHand = onHandByItem.get(entry.inventoryItemId) ?? 0;
    if (onHand < entry.requested) {
      shortfalls.push({ sku: entry.sku, requested: entry.requested, onHand });
    }
  }
  return shortfalls;
}

export function describeShortfalls(shortfalls: StockShortfall[], origin: string): string {
  return shortfalls
    .map(s => `${s.sku}: need ${s.requested.toLocaleString()}, only ${s.onHand.toLocaleString()} at ${origin}`)
    .join('\n');
}
