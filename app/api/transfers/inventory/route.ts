/**
 * Transfer Inventory API Route
 * Adjusts inventory quantities in Shopify when transfers change status
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { InventoryCacheService } from '@/lib/inventory-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface TransferItem {
  sku: string;
  quantity: number;
}

interface MarkInTransitRequest {
  action: 'mark_in_transit';
  transferId: string;
  origin: string;
  destination: string;
  items: TransferItem[];
}

interface LogDeliveryRequest {
  action: 'log_delivery';
  transferId: string;
  destination: string;
  items: { sku: string; quantity: number }[]; // quantity being delivered
}

type RequestBody = MarkInTransitRequest | LogDeliveryRequest;

// GraphQL mutation for adjusting inventory quantities (using delta values)
const INVENTORY_ADJUST_QUANTITIES_MUTATION = `
  mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors {
        field
        message
      }
      inventoryAdjustmentGroup {
        id
        reason
        changes {
          name
          delta
          quantityAfterChange
        }
      }
    }
  }
`;

async function adjustInventory(
  graphqlUrl: string,
  accessToken: string,
  adjustments: Array<{
    inventoryItemId: string;
    locationId: string;
    delta: number;
    ledgerDocumentUri: string;
  }>,
  reason: string
) {
  // Group adjustments by ledgerDocumentUri (each adjustment needs its own call due to API limitations)
  const input = {
    name: 'available', // Adjusts 'available' which affects on_hand
    reason: reason,
    changes: adjustments.map(adj => ({
      inventoryItemId: adj.inventoryItemId,
      locationId: adj.locationId,
      delta: adj.delta,
      ledgerDocumentUri: adj.ledgerDocumentUri,
    })),
  };

  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: INVENTORY_ADJUST_QUANTITIES_MUTATION,
      variables: { input },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  const result = data.data?.inventoryAdjustQuantities;
  if (result?.userErrors && result.userErrors.length > 0) {
    throw new Error(`Shopify user errors: ${result.userErrors.map((e: { message: string }) => e.message).join(', ')}`);
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: RequestBody = await request.json();
    
    const shop = process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shop || !accessToken) {
      return NextResponse.json({ error: 'Shopify credentials not configured' }, { status: 500 });
    }

    const graphqlUrl = `https://${shop}/admin/api/2024-10/graphql.json`;

    // Load inventory cache to get inventoryItemIds and locationIds
    const cacheService = new InventoryCacheService();
    const inventoryCache = await cacheService.loadCache();
    
    if (!inventoryCache?.inventory) {
      return NextResponse.json({ error: 'Inventory cache not available. Please refresh inventory first.' }, { status: 400 });
    }

    const { locationIds, locationDetails } = inventoryCache.inventory;

    if (body.action === 'mark_in_transit') {
      const { transferId, origin, destination, items } = body;
      
      console.log(`📦 Marking transfer ${transferId} in transit: ${origin} → ${destination}`);
      
      const originLocationId = locationIds[origin];
      const destLocationId = locationIds[destination];
      
      if (!originLocationId) {
        return NextResponse.json({ error: `Origin location "${origin}" not found in Shopify` }, { status: 400 });
      }
      if (!destLocationId) {
        return NextResponse.json({ error: `Destination location "${destination}" not found in Shopify` }, { status: 400 });
      }

      // Get inventoryItemIds for each SKU from origin location details
      const originDetails = locationDetails[origin] || [];
      const adjustments: Array<{
        inventoryItemId: string;
        locationId: string;
        delta: number;
        ledgerDocumentUri: string;
      }> = [];
      
      const errors: string[] = [];

      for (const item of items) {
        const detail = originDetails.find(d => d.sku === item.sku);
        if (!detail) {
          errors.push(`SKU ${item.sku} not found at ${origin}`);
          continue;
        }

        // Subtract from origin (on_hand)
        adjustments.push({
          inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
          locationId: `gid://shopify/Location/${originLocationId}`,
          delta: -item.quantity,
          ledgerDocumentUri: `app://inventory-dashboard/transfer/${transferId}/origin`,
        });

        // Add to destination (incoming) - Note: Shopify handles incoming via transfers
        // For now, we'll just subtract from origin. The incoming is tracked in Shopify transfers.
        // If you want to track incoming separately, we'd need to use Shopify's native transfer system
      }

      if (errors.length > 0 && adjustments.length === 0) {
        return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
      }

      // Execute the adjustment
      try {
        await adjustInventory(graphqlUrl, accessToken, adjustments, 'movement_updated');
        console.log(`✅ Transfer ${transferId} inventory adjusted: ${items.length} SKUs`);
      } catch (error) {
        console.error('❌ Shopify adjustment failed:', error);
        return NextResponse.json({ 
          error: 'Failed to update Shopify inventory', 
          details: error instanceof Error ? error.message : 'Unknown error',
          partialErrors: errors.length > 0 ? errors : undefined,
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        action: 'mark_in_transit',
        transferId,
        itemsAdjusted: items.length,
        warnings: errors.length > 0 ? errors : undefined,
      });

    } else if (body.action === 'log_delivery') {
      const { transferId, destination, items } = body;
      
      console.log(`📦 Logging delivery for transfer ${transferId} at ${destination}`);
      
      const destLocationId = locationIds[destination];
      
      if (!destLocationId) {
        return NextResponse.json({ error: `Destination location "${destination}" not found in Shopify` }, { status: 400 });
      }

      // Get inventoryItemIds for each SKU from destination location details
      const destDetails = locationDetails[destination] || [];
      const adjustments: Array<{
        inventoryItemId: string;
        locationId: string;
        delta: number;
        ledgerDocumentUri: string;
      }> = [];
      
      const errors: string[] = [];

      for (const item of items) {
        const detail = destDetails.find(d => d.sku === item.sku);
        if (!detail) {
          // Try to find in any location
          let foundDetail = null;
          for (const loc of Object.keys(locationDetails)) {
            foundDetail = locationDetails[loc]?.find(d => d.sku === item.sku);
            if (foundDetail) break;
          }
          if (!foundDetail) {
            errors.push(`SKU ${item.sku} not found in inventory`);
            continue;
          }
          // Use the found detail's inventoryItemId
          adjustments.push({
            inventoryItemId: `gid://shopify/InventoryItem/${foundDetail.inventoryItemId}`,
            locationId: `gid://shopify/Location/${destLocationId}`,
            delta: item.quantity,
            ledgerDocumentUri: `app://inventory-dashboard/transfer/${transferId}/delivery`,
          });
        } else {
          // Add to destination on_hand
          adjustments.push({
            inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
            locationId: `gid://shopify/Location/${destLocationId}`,
            delta: item.quantity,
            ledgerDocumentUri: `app://inventory-dashboard/transfer/${transferId}/delivery`,
          });
        }
      }

      if (errors.length > 0 && adjustments.length === 0) {
        return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
      }

      // Execute the adjustment
      try {
        await adjustInventory(graphqlUrl, accessToken, adjustments, 'received');
        console.log(`✅ Delivery logged for transfer ${transferId}: ${items.length} SKUs`);
      } catch (error) {
        console.error('❌ Shopify adjustment failed:', error);
        return NextResponse.json({ 
          error: 'Failed to update Shopify inventory', 
          details: error instanceof Error ? error.message : 'Unknown error',
          partialErrors: errors.length > 0 ? errors : undefined,
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        action: 'log_delivery',
        transferId,
        itemsAdjusted: items.length,
        warnings: errors.length > 0 ? errors : undefined,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('❌ Transfer inventory update failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
