/**
 * Shopify GraphQL Transfer Service
 * Dedicated service for fetching inventory transfers via GraphQL Admin API
 * Uses API version 2026-01 (latest stable)
 * 
 * This is separate from ShopifyQL queries to avoid conflicts.
 */

export interface GraphQLTransferLineItem {
  sku: string;
  quantity: number;
  receivedQuantity: number;
  productTitle: string;
  variantTitle: string;
}

export interface GraphQLTransfer {
  id: string;
  name: string;
  status: string;
  originLocationName: string;
  destinationLocationName: string;
  createdAt: string;
  expectedArrivalAt: string | null;
  note: string | null;
  tags: string[];
  lineItems: GraphQLTransferLineItem[];
}

export interface TransferDataBySku {
  sku: string;
  totalInTransit: number;
  transfers: Array<{
    transferId: string;
    transferName: string;
    quantity: number;
    tags: string[];
    note: string | null;
    originLocationName: string;
    destinationLocationName: string;
  }>;
}

export class ShopifyGraphQLTransferService {
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
    // Use 2026-01 API version (latest stable per Shopify docs)
    this.apiUrl = `https://${shop}/admin/api/2026-01/graphql.json`;
  }

  /**
   * Execute a GraphQL query against Shopify Admin API
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeGraphQL(query: string): Promise<any> {
    console.log(`🔗 GraphQL Transfer API: ${this.apiUrl}`);
    
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
  }

  /**
   * Fetch all in-progress inventory transfers via GraphQL
   * Uses the exact query format confirmed working in Shopify
   */
  async getInProgressTransfers(): Promise<GraphQLTransfer[]> {
    console.log('📦 Fetching in-progress transfers via GraphQL...');

    const query = `
      {
        inventoryTransfers(first: 50, query: "status:IN_PROGRESS OR status:READY_TO_SHIP") {
          edges {
            node {
              id
              name
              status
              originLocation {
                name
              }
              destinationLocation {
                name
              }
              createdAt
              updatedAt
              expectedArrivalAt
              confirmedAt
              transferredAt
              canceledAt
              referenceNumber
              note
              tags
              lineItems(first: 100) {
                edges {
                  node {
                    id
                    quantity
                    receivedQuantity
                    inventoryItem {
                      id
                      variant {
                        id
                        sku
                        title
                        displayName
                        barcode
                        inventoryQuantity
                        product {
                          title
                        }
                      }
                    }
                  }
                }
              }
              shipments(first: 50) {
                edges {
                  node {
                    id
                    status
                    trackingNumber
                    carrier
                    shippedAt
                    receivedAt
                    expectedDeliveryAt
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.executeGraphQL(query);

      if (!result?.inventoryTransfers?.edges) {
        console.log('⚠️ No transfer data returned from GraphQL');
        return [];
      }

      const transfers: GraphQLTransfer[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const edge of result.inventoryTransfers.edges) {
        const node = edge.node;
        
        // Parse line items
        const lineItems: GraphQLTransferLineItem[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const lineEdge of node.lineItems?.edges || []) {
          const lineNode = lineEdge.node;
          const variant = lineNode.inventoryItem?.variant;
          
          if (variant?.sku) {
            lineItems.push({
              sku: variant.sku,
              quantity: lineNode.quantity || 0,
              receivedQuantity: lineNode.receivedQuantity || 0,
              productTitle: variant.product?.title || '',
              variantTitle: variant.title || '',
            });
          }
        }

        transfers.push({
          id: node.id,
          name: node.name || '',
          status: node.status || '',
          originLocationName: node.originLocation?.name || '',
          destinationLocationName: node.destinationLocation?.name || '',
          createdAt: node.createdAt || '',
          expectedArrivalAt: node.expectedArrivalAt || null,
          note: node.note || null,
          tags: Array.isArray(node.tags) ? node.tags : [],
          lineItems,
        });
      }

      console.log(`✅ Fetched ${transfers.length} in-progress transfers via GraphQL`);
      return transfers;
    } catch (error) {
      console.error('❌ GraphQL transfer fetch failed:', error);
      // Return empty array instead of throwing to not break the refresh
      return [];
    }
  }

  /**
   * Get transfer data aggregated by SKU
   * Returns total in-transit quantity for each SKU
   */
  async getTransferDataBySku(): Promise<Map<string, TransferDataBySku>> {
    const transfers = await this.getInProgressTransfers();
    const skuMap = new Map<string, TransferDataBySku>();

    for (const transfer of transfers) {
      // Extract short ID from GID (e.g., "gid://shopify/InventoryTransfer/12345" -> "T12345")
      const numericId = transfer.id.split('/').pop() || '';
      const transferId = numericId ? `T${numericId}` : transfer.id;

      for (const lineItem of transfer.lineItems) {
        const sku = lineItem.sku;
        if (!sku) continue;

        // Calculate remaining quantity (ordered - received)
        const remainingQty = lineItem.quantity - lineItem.receivedQuantity;
        if (remainingQty <= 0) continue;

        if (!skuMap.has(sku)) {
          skuMap.set(sku, {
            sku,
            totalInTransit: 0,
            transfers: [],
          });
        }

        const skuData = skuMap.get(sku)!;
        skuData.totalInTransit += remainingQty;
        skuData.transfers.push({
          transferId,
          transferName: transfer.name,
          quantity: remainingQty,
          tags: transfer.tags,
          note: transfer.note,
          originLocationName: transfer.originLocationName,
          destinationLocationName: transfer.destinationLocationName,
        });
      }
    }

    console.log(`✅ Aggregated transfer data for ${skuMap.size} SKUs`);
    return skuMap;
  }
}
