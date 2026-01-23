/**
 * Shopify API Client
 * Clean, simple interface for fetching inventory data
 */

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  tags: string;
  variants: ShopifyVariant[];
  created_at: string;
  updated_at: string;
}

export interface ShopifyVariant {
  id: string;
  product_id: string;
  title: string;
  sku: string;
  price: string;
  inventory_item_id: string;
  inventory_quantity: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryLevel {
  inventory_item_id: string;
  location_id: string;
  available: number;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  cost: string | null;
  tracked: boolean;
  created_at: string;
  updated_at: string;
}

interface ShopifyConfig {
  shop: string;
  accessToken: string;
}

export class ShopifyClient {
  private config: ShopifyConfig;
  private baseUrl: string;

  constructor() {
    const shop = process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shop || !accessToken) {
      throw new Error('Missing Shopify credentials');
    }

    this.config = { shop, accessToken };
    this.baseUrl = `https://${shop}/admin/api/2024-10`;
  }

  /**
   * Fetch all products with their variants
   */
  async fetchProducts(limit: number = 250): Promise<ShopifyProduct[]> {
    const products: ShopifyProduct[] = [];
    let url: string | null = null;

    do {
      const urlObj = new URL(url || `${this.baseUrl}/products.json`);
      if (!url) {
        urlObj.searchParams.set('limit', limit.toString());
        urlObj.searchParams.set('status', 'active');
      }

      console.log(`📡 Fetching products from: ${urlObj.toString()}`);
      const response = await fetch(urlObj.toString(), {
        headers: {
          'X-Shopify-Access-Token': this.config.accessToken,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Products API error: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Shopify API error (products): ${response.statusText}`);
      }

      const data = await response.json();
      products.push(...(data.products || []));

      // Check for pagination
      const linkHeader = response.headers.get('Link');
      url = this.getNextPageUrl(linkHeader);

      // Rate limiting - wait 0.5s between requests
      if (url) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } while (url);

    return products;
  }

  /**
   * Fetch inventory levels for a specific location
   */
  async fetchInventoryLevels(locationId: string): Promise<InventoryLevel[]> {
    const levels: InventoryLevel[] = [];
    let url: string | null = null;

    do {
      const urlObj = new URL(url || `${this.baseUrl}/inventory_levels.json`);
      if (!url) {
        urlObj.searchParams.set('location_ids', locationId);
        urlObj.searchParams.set('limit', '250');
      }

      const response = await fetch(urlObj.toString(), {
        headers: {
          'X-Shopify-Access-Token': this.config.accessToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.statusText}`);
      }

      const data = await response.json();
      levels.push(...(data.inventory_levels || []));

      // Check for pagination
      const linkHeader = response.headers.get('Link');
      url = this.getNextPageUrl(linkHeader);

      // Rate limiting
      if (url) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } while (url);

    return levels;
  }

  /**
   * Fetch all locations
   */
  async fetchLocations(): Promise<Array<{ id: string; name: string; active: boolean }>> {
    console.log(`📡 Fetching locations from: ${this.baseUrl}/locations.json`);
    const response = await fetch(`${this.baseUrl}/locations.json`, {
      headers: {
        'X-Shopify-Access-Token': this.config.accessToken,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Locations API error: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Shopify API error (locations): ${response.statusText}`);
    }

    const data = await response.json();
    return data.locations || [];
  }

  /**
   * Fetch detailed inventory levels using GraphQL
   * Returns on_hand, available, committed, incoming quantities
   */
  async fetchDetailedInventoryLevels(locationId: string): Promise<Array<{
    inventoryItemId: string;
    available: number;
    onHand: number;
    committed: number;
    incoming: number;
  }>> {
    const graphqlUrl = `https://${this.config.shop}/admin/api/2024-10/graphql.json`;
    const results: Array<{
      inventoryItemId: string;
      available: number;
      onHand: number;
      committed: number;
      incoming: number;
    }> = [];
    
    let cursor: string | null = null;
    let hasNextPage = true;
    
    while (hasNextPage) {
      const query = `
        query($locationId: ID!, $cursor: String) {
          location(id: $locationId) {
            inventoryLevels(first: 250, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  item {
                    id
                  }
                  quantities(names: ["available", "on_hand", "committed", "incoming"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      `;
      
      const response: Response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': this.config.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: {
            locationId: `gid://shopify/Location/${locationId}`,
            cursor,
          },
        }),
      });
      
      if (!response.ok) {
        throw new Error(`GraphQL API error: ${response.statusText}`);
      }
      
      const data: any = await response.json();
      
      if (data.errors) {
        console.error('GraphQL errors:', data.errors);
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }
      
      const inventoryLevels = data.data?.location?.inventoryLevels;
      if (!inventoryLevels) break;
      
      for (const edge of inventoryLevels.edges) {
        const node = edge.node;
        const itemId = node.item.id.replace('gid://shopify/InventoryItem/', '');
        
        const quantities: Record<string, number> = {};
        for (const q of node.quantities) {
          quantities[q.name] = q.quantity;
        }
        
        results.push({
          inventoryItemId: itemId,
          available: quantities.available || 0,
          onHand: quantities.on_hand || 0,
          committed: quantities.committed || 0,
          incoming: quantities.incoming || 0,
        });
      }
      
      hasNextPage = inventoryLevels.pageInfo.hasNextPage;
      cursor = inventoryLevels.pageInfo.endCursor;
      
      // Rate limiting
      if (hasNextPage) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    return results;
  }

  /**
   * Fetch inventory items by IDs
   */
  async fetchInventoryItems(ids: string[]): Promise<InventoryItem[]> {
    const items: InventoryItem[] = [];
    
    // Shopify limits to 100 IDs per request
    const chunks = this.chunkArray(ids, 100);
    
    for (const chunk of chunks) {
      const url = new URL(`${this.baseUrl}/inventory_items.json`);
      url.searchParams.set('ids', chunk.join(','));

      const response = await fetch(url.toString(), {
        headers: {
          'X-Shopify-Access-Token': this.config.accessToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.statusText}`);
      }

      const data = await response.json();
      items.push(...(data.inventory_items || []));

      // Rate limiting
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return items;
  }

  /**
   * Fetch inventory transfers (for inbound air/sea tracking)
   * Returns transfers with their tags, notes, and line items
   */
  async fetchTransfers(): Promise<Array<{
    id: string;
    number: string;
    status: string;
    tags: string[];
    note: string | null;
    destinationLocationId: string;
    lineItems: Array<{
      inventoryItemId: string;
      sku: string;
      quantity: number;
      receivedQuantity: number;
    }>;
  }>> {
    const graphqlUrl = `https://${this.config.shop}/admin/api/2024-10/graphql.json`;
    const results: Array<{
      id: string;
      number: string;
      status: string;
      tags: string[];
      note: string | null;
      destinationLocationId: string;
      lineItems: Array<{
        inventoryItemId: string;
        sku: string;
        quantity: number;
        receivedQuantity: number;
      }>;
    }> = [];
    
    let cursor: string | null = null;
    let hasNextPage = true;
    
    while (hasNextPage) {
      const query = `
        query($cursor: String) {
          inventoryTransfers(first: 50, after: $cursor, query: "status:pending OR status:partially_received") {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                number
                status
                tags
                note
                destinationLocation {
                  id
                }
                expectedArrivalDate
                inventoryTransferItems(first: 250) {
                  edges {
                    node {
                      inventoryItem {
                        id
                        sku
                      }
                      quantity
                      receivedQuantity
                    }
                  }
                }
              }
            }
          }
        }
      `;
      
      const response: Response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': this.config.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { cursor },
        }),
      });
      
      if (!response.ok) {
        throw new Error(`GraphQL API error: ${response.statusText}`);
      }
      
      const data: any = await response.json();
      
      if (data.errors) {
        console.error('GraphQL errors:', data.errors);
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }
      
      const transfers = data.data?.inventoryTransfers;
      if (!transfers) break;
      
      for (const edge of transfers.edges) {
        const node = edge.node;
        const destLocationId = node.destinationLocation?.id?.replace('gid://shopify/Location/', '') || '';
        
        const lineItems = node.inventoryTransferItems.edges.map((itemEdge: any) => ({
          inventoryItemId: itemEdge.node.inventoryItem.id.replace('gid://shopify/InventoryItem/', ''),
          sku: itemEdge.node.inventoryItem.sku || '',
          quantity: itemEdge.node.quantity,
          receivedQuantity: itemEdge.node.receivedQuantity || 0,
        }));
        
        results.push({
          id: node.id.replace('gid://shopify/InventoryTransfer/', ''),
          number: node.number || '',
          status: node.status,
          tags: node.tags || [],
          note: node.note || null,
          destinationLocationId: destLocationId,
          lineItems,
        });
      }
      
      hasNextPage = transfers.pageInfo.hasNextPage;
      cursor = transfers.pageInfo.endCursor;
      
      // Rate limiting
      if (hasNextPage) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`📦 Fetched ${results.length} pending/partial transfers`);
    return results;
  }

  /**
   * Extract next page URL from Link header
   */
  private getNextPageUrl(linkHeader: string | null): string | null {
    if (!linkHeader) return null;

    const links = linkHeader.split(',');
    const nextLink = links.find(link => link.includes('rel="next"'));

    if (!nextLink) return null;

    const match = nextLink.match(/<(.+?)>/);
    return match ? match[1] : null;
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

/**
 * Inventory data structure for analytics
 */
export interface InventoryData {
  sku: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  price: number;
  cost: number | null;
  inventoryItemId: string;
  productId: string;
  variantId: string;
}

/**
 * Process products and inventory into a unified data structure
 */
export function processInventoryData(
  products: ShopifyProduct[],
  inventoryLevels: InventoryLevel[],
  inventoryItems: InventoryItem[]
): InventoryData[] {
  const levelMap = new Map<string, number>();
  for (const level of inventoryLevels) {
    levelMap.set(level.inventory_item_id, level.available);
  }

  const costMap = new Map<string, number | null>();
  for (const item of inventoryItems) {
    costMap.set(item.id, item.cost ? parseFloat(item.cost) : null);
  }

  const inventoryData: InventoryData[] = [];

  for (const product of products) {
    for (const variant of product.variants) {
      if (!variant.sku) continue;

      inventoryData.push({
        sku: variant.sku,
        productTitle: product.title,
        variantTitle: variant.title,
        quantity: levelMap.get(variant.inventory_item_id) ?? variant.inventory_quantity,
        price: parseFloat(variant.price),
        cost: costMap.get(variant.inventory_item_id) ?? null,
        inventoryItemId: variant.inventory_item_id,
        productId: variant.product_id,
        variantId: variant.id,
      });
    }
  }

  return inventoryData.sort((a, b) => a.sku.localeCompare(b.sku));
}
