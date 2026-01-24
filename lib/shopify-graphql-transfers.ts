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
   * Uses introspection to discover available fields, then builds a compatible query
   */
  async getInProgressTransfers(): Promise<GraphQLTransfer[]> {
    console.log('📦 Fetching in-progress transfers via GraphQL...');

    // First, introspect to discover what fields are available
    const introspectionQuery = `
      {
        transfer: __type(name: "InventoryTransfer") {
          fields { name }
        }
        lineItem: __type(name: "InventoryTransferLineItem") {
          fields { name }
        }
      }
    `;

    try {
      const schemaResult = await this.executeGraphQL(introspectionQuery);
      const transferFields = new Set<string>(
        (schemaResult?.transfer?.fields || []).map((f: { name: string }) => f.name)
      );
      const lineItemFields = new Set<string>(
        (schemaResult?.lineItem?.fields || []).map((f: { name: string }) => f.name)
      );

      console.log(`📋 Available InventoryTransfer fields: ${Array.from(transferFields).join(', ')}`);
      console.log(`📋 Available LineItem fields: ${Array.from(lineItemFields).join(', ')}`);

      // Build query dynamically based on available fields
      const hasLineItems = transferFields.has('lineItems');
      if (!hasLineItems) {
        console.warn('⚠️ lineItems field not available on InventoryTransfer');
        return [];
      }

      // Find quantity field (could be quantity, expectedQuantity, requestedQuantity, etc.)
      const quantityField = ['quantity', 'expectedQuantity', 'requestedQuantity', 'orderedQuantity']
        .find(f => lineItemFields.has(f));
      const receivedField = ['receivedQuantity', 'received'].find(f => lineItemFields.has(f));

      if (!quantityField) {
        console.warn('⚠️ No quantity field found on InventoryTransferLineItem');
        return [];
      }

      // Build line item selection
      const lineItemSelections = [
        'id',
        quantityField,
        receivedField,
        lineItemFields.has('inventoryItem') ? 'inventoryItem { id sku variant { sku product { title } } }' : '',
        lineItemFields.has('sku') ? 'sku' : '',
      ].filter(Boolean).join('\n');

      // Build transfer selection
      const transferSelections = [
        'id',
        transferFields.has('name') ? 'name' : '',
        transferFields.has('status') ? 'status' : '',
        transferFields.has('note') ? 'note' : '',
        transferFields.has('tags') ? 'tags' : '',
        transferFields.has('origin') ? 'origin { name }' : '',
        transferFields.has('destination') ? 'destination { name }' : '',
        transferFields.has('originLocation') ? 'originLocation { name }' : '',
        transferFields.has('destinationLocation') ? 'destinationLocation { name }' : '',
        transferFields.has('createdAt') ? 'createdAt' : '',
        transferFields.has('expectedArrivalAt') ? 'expectedArrivalAt' : '',
        `lineItems(first: 100) { edges { node { ${lineItemSelections} } } }`,
      ].filter(Boolean).join('\n');

      const query = `
        {
          inventoryTransfers(first: 50, query: "status:IN_PROGRESS OR status:READY_TO_SHIP") {
            edges {
              node {
                ${transferSelections}
              }
            }
          }
        }
      `;

      console.log('📝 Built dynamic query based on schema');
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
          
          // Try to get SKU from various possible locations
          const sku = lineNode.sku || 
                      lineNode.inventoryItem?.sku || 
                      lineNode.inventoryItem?.variant?.sku || 
                      '';
          
          // Get quantity from whatever field is available
          const quantity = lineNode.quantity || 
                          lineNode.expectedQuantity || 
                          lineNode.requestedQuantity || 
                          lineNode.orderedQuantity || 
                          0;
          
          const receivedQuantity = lineNode.receivedQuantity || 
                                   lineNode.received || 
                                   0;
          
          if (sku) {
            lineItems.push({
              sku,
              quantity,
              receivedQuantity,
              productTitle: lineNode.inventoryItem?.variant?.product?.title || '',
              variantTitle: '',
            });
          }
        }

        // Get origin/destination from various possible field names
        const originLocationName = node.originLocation?.name || 
                                   node.origin?.name || 
                                   '';
        const destinationLocationName = node.destinationLocation?.name || 
                                        node.destination?.name || 
                                        '';

        transfers.push({
          id: node.id,
          name: node.name || '',
          status: node.status || '',
          originLocationName,
          destinationLocationName,
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
