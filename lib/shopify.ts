/**
 * Shopify API Client
 * Clean, simple interface for fetching inventory data
 */

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
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

      const response = await fetch(urlObj.toString(), {
        headers: {
          'X-Shopify-Access-Token': this.config.accessToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.statusText}`);
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
    const response = await fetch(`${this.baseUrl}/locations.json`, {
      headers: {
        'X-Shopify-Access-Token': this.config.accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.locations || [];
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
