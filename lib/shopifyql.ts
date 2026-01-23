/**
 * ShopifyQL Service for Inventory Data
 * Queries Shopify inventory using ShopifyQL on unstable API
 */

interface ShopifyQLColumn {
  name: string;
  dataType: string;
  displayName: string;
}

interface ShopifyQLTableData {
  columns: ShopifyQLColumn[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: Record<string, any>[];
}

interface ShopifyQLResponse {
  parseErrors: string[];
  tableData: ShopifyQLTableData | null;
}

export interface InventoryRow {
  productTitle: string;
  variantTitle: string;
  sku: string;
  locationName: string;
  availableQuantity: number;
  onHandQuantity: number;
  committedQuantity: number;
  unavailableQuantity: number;
  incomingQuantity: number;
}

export interface InventoryByLocation {
  sku: string;
  productTitle: string;
  variantTitle: string;
  locations: Record<string, {
    available: number;
    onHand: number;
    committed: number;
    unavailable: number;
    incoming: number;
  }>;
  totalAvailable: number;
  totalOnHand: number;
}

export interface InventorySummary {
  totalSKUs: number;
  totalUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  locations: string[];
  inventory: InventoryByLocation[];
  lastUpdated: string;
}

export interface SKUSalesData {
  sku: string;
  productName: string;
  quantity: number;
}

export interface ForecastingData {
  sku: string;
  productName: string;
  avgDaily7d: number;
  avgDaily21d: number;
  avgDaily90d: number;
  avgDailyLastYear30d: number;
  totalInventory?: number;
  daysOfStock?: number;
}

export interface PurchaseOrderData {
  sku: string;
  pendingQuantity: number; // Total quantity ordered but not yet fully received
}

export class ShopifyQLService {
  private shop: string;
  private accessToken: string;
  private apiUrl: string;

  constructor() {
    const shop = process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shop || !accessToken) {
      throw new Error('Missing Shopify credentials');
    }

    this.shop = shop;
    this.accessToken = accessToken;
    this.apiUrl = `https://${shop}/admin/api/unstable/graphql.json`;
  }

  /**
   * Execute a ShopifyQL query via GraphQL
   */
  private async executeQuery(shopifyQLQuery: string): Promise<ShopifyQLResponse> {
    const graphqlQuery = `
      query($shopifyQl: String!) {
        shopifyqlQuery(query: $shopifyQl) {
          parseErrors
          tableData {
            columns {
              name
              dataType
              displayName
            }
            rows
          }
        }
      }
    `;

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { shopifyQl: shopifyQLQuery },
      }),
    });

    if (!response.ok) {
      throw new Error(`ShopifyQL API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    const result = data.data?.shopifyqlQuery;

    if (!result) {
      throw new Error('No shopifyqlQuery in response');
    }

    return result;
  }

  /**
   * Get inventory data for all SKUs across all locations
   */
  async getInventoryData(): Promise<InventorySummary> {
    const query = `
      FROM inventory
      SHOW product_title,
        product_variant_title,
        product_variant_sku,
        location_name,
        available_quantity,
        on_hand_quantity,
        committed_quantity,
        unavailable_quantity,
        incoming_quantity
      WHERE inventory_is_tracked = true
      GROUP BY product_title,
        product_variant_title,
        product_variant_sku,
        location_name
      ORDER BY product_variant_sku ASC,
        location_name ASC
    `;

    console.log('📦 Fetching inventory data from Shopify...');
    const result = await this.executeQuery(query);

    if (result.parseErrors && result.parseErrors.length > 0) {
      throw new Error(`ShopifyQL parse errors: ${result.parseErrors.join(', ')}`);
    }

    if (!result.tableData) {
      throw new Error('No table data returned');
    }

    // Parse raw rows into InventoryRow objects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: InventoryRow[] = result.tableData.rows.map((row: any) => ({
      productTitle: row.product_title || '',
      variantTitle: row.product_variant_title || '',
      sku: row.product_variant_sku || '',
      locationName: row.location_name || '',
      availableQuantity: parseInt(row.available_quantity || '0', 10),
      onHandQuantity: parseInt(row.on_hand_quantity || '0', 10),
      committedQuantity: parseInt(row.committed_quantity || '0', 10),
      unavailableQuantity: parseInt(row.unavailable_quantity || '0', 10),
      incomingQuantity: parseInt(row.incoming_quantity || '0', 10),
    }));

    // Extract unique locations
    const locationsSet = new Set<string>();
    rows.forEach(row => locationsSet.add(row.locationName));
    const locations = Array.from(locationsSet).sort();

    // Group by SKU
    const skuMap = new Map<string, InventoryByLocation>();

    for (const row of rows) {
      if (!row.sku) continue;

      let skuData = skuMap.get(row.sku);
      if (!skuData) {
        skuData = {
          sku: row.sku,
          productTitle: row.productTitle,
          variantTitle: row.variantTitle,
          locations: {},
          totalAvailable: 0,
          totalOnHand: 0,
        };
        skuMap.set(row.sku, skuData);
      }

      skuData.locations[row.locationName] = {
        available: row.availableQuantity,
        onHand: row.onHandQuantity,
        committed: row.committedQuantity,
        unavailable: row.unavailableQuantity,
        incoming: row.incomingQuantity,
      };

      skuData.totalAvailable += row.availableQuantity;
      skuData.totalOnHand += row.onHandQuantity;
    }

    const inventory = Array.from(skuMap.values());

    // Calculate summary stats
    const totalSKUs = inventory.length;
    const totalUnits = inventory.reduce((sum, item) => sum + item.totalAvailable, 0);
    const outOfStockCount = inventory.filter(item => item.totalAvailable <= 0).length;
    const lowStockCount = inventory.filter(item => item.totalAvailable > 0 && item.totalAvailable <= 10).length;

    console.log(`✅ Loaded ${totalSKUs} SKUs across ${locations.length} locations`);

    return {
      totalSKUs,
      totalUnits,
      lowStockCount,
      outOfStockCount,
      locations,
      inventory,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get SKU-level sales data for a specific time range
   */
  private async getSKUSalesData(timeClause: string): Promise<SKUSalesData[]> {
    const query = `
      FROM sales
        SHOW product_variant_sku, product_title, net_items_sold
        GROUP BY product_variant_sku, product_title
        ${timeClause}
        ORDER BY net_items_sold DESC
    `;

    const result = await this.executeQuery(query);

    if (result.parseErrors && result.parseErrors.length > 0) {
      throw new Error(`ShopifyQL parse errors: ${result.parseErrors.join(', ')}`);
    }

    if (!result.tableData) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.tableData.rows.map((row: any) => ({
      sku: row.product_variant_sku || '',
      productName: row.product_title || '',
      quantity: parseInt(row.net_items_sold || '0', 10),
    }));
  }

  /**
   * Get forecasting data - average daily sales for different periods
   * All periods end at end of yesterday (excludes today's partial data)
   */
  async getForecastingData(): Promise<ForecastingData[]> {
    console.log('📊 Fetching sales data for forecasting...');

    // Fetch sales data for different periods in parallel
    // All ranges use full days only (yesterday back), excluding today's incomplete data
    const [sales7d, sales21d, sales90d, salesLastYear30d] = await Promise.all([
      // 7 days: yesterday and the 6 days before it (7 full days total)
      this.getSKUSalesData('SINCE startOfDay(-7d) UNTIL endOfDay(-1d)'),
      // 21 days (3 weeks): yesterday and the 20 days before it (21 full days total)
      this.getSKUSalesData('SINCE startOfDay(-21d) UNTIL endOfDay(-1d)'),
      // 90 days (3 months): yesterday and the 89 days before it (90 full days total)
      this.getSKUSalesData('SINCE startOfDay(-90d) UNTIL endOfDay(-1d)'),
      // Last year same 30-day period: 365 days ago through 336 days ago (30 full days)
      this.getSKUSalesData('SINCE startOfDay(-395d) UNTIL endOfDay(-366d)'),
    ]);

    console.log(`✅ Fetched sales: 7d=${sales7d.length}, 21d=${sales21d.length}, 90d=${sales90d.length}, LY30d=${salesLastYear30d.length} SKUs`);

    // Build maps for quick lookup
    const map7d = new Map(sales7d.map(s => [s.sku, s]));
    const map21d = new Map(sales21d.map(s => [s.sku, s]));
    const map90d = new Map(sales90d.map(s => [s.sku, s]));
    const mapLY30d = new Map(salesLastYear30d.map(s => [s.sku, s]));

    // Get all unique SKUs
    const allSkus = new Set<string>();
    sales7d.forEach(s => allSkus.add(s.sku));
    sales21d.forEach(s => allSkus.add(s.sku));
    sales90d.forEach(s => allSkus.add(s.sku));
    salesLastYear30d.forEach(s => allSkus.add(s.sku));

    // Build forecasting data
    const forecastingData: ForecastingData[] = [];

    for (const sku of allSkus) {
      if (!sku) continue;

      const d7 = map7d.get(sku);
      const d21 = map21d.get(sku);
      const d90 = map90d.get(sku);
      const ly30 = mapLY30d.get(sku);

      // Get product name from any available source
      const productName = d7?.productName || d21?.productName || d90?.productName || ly30?.productName || '';

      forecastingData.push({
        sku,
        productName,
        avgDaily7d: d7 ? d7.quantity / 7 : 0,
        avgDaily21d: d21 ? d21.quantity / 21 : 0,
        avgDaily90d: d90 ? d90.quantity / 90 : 0,
        avgDailyLastYear30d: ly30 ? ly30.quantity / 30 : 0,
      });
    }

    // Sort by 7-day average (most active first)
    forecastingData.sort((a, b) => b.avgDaily7d - a.avgDaily7d);

    console.log(`✅ Built forecasting data for ${forecastingData.length} SKUs`);
    return forecastingData;
  }

  /**
   * Execute a raw GraphQL query (not ShopifyQL)
   */
  private async executeGraphQL(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
  }

  /**
   * Get Purchase Order data - pending quantities by SKU
   * Fetches all POs that are not fully received and aggregates quantities by SKU
   */
  async getPurchaseOrderData(): Promise<PurchaseOrderData[]> {
    console.log('📦 Fetching purchase order data from Shopify...');

    const query = `
      query($cursor: String) {
        purchaseOrders(first: 100, after: $cursor, query: "status:open OR status:partial") {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              status
              lineItems(first: 100) {
                edges {
                  node {
                    sku
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

    // Aggregate pending quantities by SKU
    const skuQuantities = new Map<string, number>();
    let cursor: string | null = null;
    let hasNextPage = true;
    let totalPOs = 0;

    while (hasNextPage) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await this.executeGraphQL(query, { cursor });
      const purchaseOrders = data?.purchaseOrders;

      if (!purchaseOrders) {
        console.log('⚠️ No purchase orders data returned');
        break;
      }

      for (const edge of purchaseOrders.edges) {
        const po = edge.node;
        totalPOs++;

        for (const lineEdge of po.lineItems.edges) {
          const line = lineEdge.node;
          const sku = line.sku;
          if (!sku) continue;

          // Pending = ordered - received
          const pending = Math.max(0, (line.quantity || 0) - (line.receivedQuantity || 0));
          if (pending > 0) {
            skuQuantities.set(sku, (skuQuantities.get(sku) || 0) + pending);
          }
        }
      }

      hasNextPage = purchaseOrders.pageInfo.hasNextPage;
      cursor = purchaseOrders.pageInfo.endCursor;
    }

    // Convert to array
    const result: PurchaseOrderData[] = [];
    for (const [sku, pendingQuantity] of skuQuantities) {
      result.push({ sku, pendingQuantity });
    }

    console.log(`✅ Found ${result.length} SKUs with pending PO quantities from ${totalPOs} purchase orders`);
    return result;
  }
}
