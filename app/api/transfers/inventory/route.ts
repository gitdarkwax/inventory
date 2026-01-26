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
  inventoryName: 'available' | 'incoming', // 'available' affects on_hand, 'incoming' is in-transit stock
  adjustments: Array<{
    inventoryItemId: string;
    locationId: string;
    delta: number;
    ledgerDocumentUri: string;
  }>,
  reason: string
) {
  const input = {
    name: inventoryName,
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
      const originAdjustments: Array<{
        inventoryItemId: string;
        locationId: string;
        delta: number;
        ledgerDocumentUri: string;
      }> = [];
      const destIncomingAdjustments: Array<{
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

        // Subtract from origin's available (on_hand)
        originAdjustments.push({
          inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
          locationId: `gid://shopify/Location/${originLocationId}`,
          delta: -item.quantity,
          ledgerDocumentUri: `app://inventory-dashboard/transfer/${transferId}/origin`,
        });

        // Add to destination's incoming
        destIncomingAdjustments.push({
          inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
          locationId: `gid://shopify/Location/${destLocationId}`,
          delta: item.quantity,
          ledgerDocumentUri: `app://inventory-dashboard/transfer/${transferId}/incoming`,
        });
      }

      if (errors.length > 0 && originAdjustments.length === 0) {
        return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
      }

      // Execute the adjustments (two separate calls - one for available, one for incoming)
      try {
        // Step 1: Subtract from origin's available (on_hand)
        await adjustInventory(graphqlUrl, accessToken, 'available', originAdjustments, 'movement_updated');
        console.log(`✅ Subtracted from origin ${origin}: ${originAdjustments.length} SKUs`);

        // Step 2: Add to destination's incoming
        await adjustInventory(graphqlUrl, accessToken, 'incoming', destIncomingAdjustments, 'movement_created');
        console.log(`✅ Added to destination ${destination} incoming: ${destIncomingAdjustments.length} SKUs`);

        console.log(`✅ Transfer ${transferId} fully adjusted`);
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
      const incomingAdjustments: Array<{
        inventoryItemId: string;
        locationId: string;
        delta: number;
        ledgerDocumentUri: string;
      }> = [];
      const availableAdjustments: Array<{
        inventoryItemId: string;
        locationId: string;
        delta: number;
        ledgerDocumentUri: string;
      }> = [];
      
      const errors: string[] = [];

      for (const item of items) {
        let detail = destDetails.find(d => d.sku === item.sku);
        if (!detail) {
          // Try to find in any location
          for (const loc of Object.keys(locationDetails)) {
            detail = locationDetails[loc]?.find(d => d.sku === item.sku);
            if (detail) break;
          }
          if (!detail) {
            errors.push(`SKU ${item.sku} not found in inventory`);
            continue;
          }
        }

        // Subtract from destination's incoming
        incomingAdjustments.push({
          inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
          locationId: `gid://shopify/Location/${destLocationId}`,
          delta: -item.quantity,
          ledgerDocumentUri: `app://inventory-dashboard/transfer/${transferId}/delivery-incoming`,
        });

        // Add to destination's available (on_hand)
        availableAdjustments.push({
          inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
          locationId: `gid://shopify/Location/${destLocationId}`,
          delta: item.quantity,
          ledgerDocumentUri: `app://inventory-dashboard/transfer/${transferId}/delivery-onhand`,
        });
      }

      if (errors.length > 0 && availableAdjustments.length === 0) {
        return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
      }

      // Execute the adjustments (two separate calls)
      try {
        // Step 1: Subtract from incoming
        await adjustInventory(graphqlUrl, accessToken, 'incoming', incomingAdjustments, 'movement_updated');
        console.log(`✅ Subtracted from ${destination} incoming: ${incomingAdjustments.length} SKUs`);

        // Step 2: Add to available (on_hand)
        await adjustInventory(graphqlUrl, accessToken, 'available', availableAdjustments, 'received');
        console.log(`✅ Added to ${destination} on_hand: ${availableAdjustments.length} SKUs`);

        console.log(`✅ Delivery logged for transfer ${transferId}`);
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
