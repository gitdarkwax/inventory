/**
 * Transfer Inventory API Route
 * Adjusts inventory quantities in Shopify when transfers change status
 * 
 * Note: Shopify doesn't allow API writes to the "incoming" field, so we track
 * incoming quantities locally in our app based on in-transit transfers.
 * 
 * Shipment Types:
 * - Air Express / Air Slow / Sea: Subtract from origin On Hand only (incoming tracked in app)
 * - Immediate: Full inter-location transfer (subtract origin, add destination On Hand)
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { InventoryCacheService } from '@/lib/inventory-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type ShipmentType = 'Air Express' | 'Air Slow' | 'Sea' | 'Immediate';

interface TransferItem {
  sku: string;
  quantity: number;
}

interface MarkInTransitRequest {
  action: 'mark_in_transit';
  transferId: string;
  origin: string;
  destination: string;
  shipmentType: ShipmentType;
  items: TransferItem[];
}

interface LogDeliveryRequest {
  action: 'log_delivery';
  transferId: string;
  destination: string;
  shipmentType: ShipmentType; // Needed to know which incoming column to subtract from
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
  }>,
  reason: string
) {
  // Note: ledgerDocumentUri is NOT allowed when adjusting 'available' inventory
  const input = {
    name: 'available', // Always adjust 'available' which affects on_hand
    reason: reason,
    changes: adjustments.map(adj => ({
      inventoryItemId: adj.inventoryItemId,
      locationId: adj.locationId,
      delta: adj.delta,
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

    if (!locationIds || !locationDetails) {
      return NextResponse.json({ error: 'Inventory cache incomplete. Please refresh inventory first.' }, { status: 400 });
    }

    if (body.action === 'mark_in_transit') {
      const { transferId, origin, destination, shipmentType, items } = body;
      
      const isImmediate = shipmentType === 'Immediate';
      console.log(`📦 ${isImmediate ? 'Processing immediate transfer' : 'Marking transfer in transit'} ${transferId}: ${origin} → ${destination} [${shipmentType}]`);
      
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
      }> = [];
      const destAdjustments: Array<{
        inventoryItemId: string;
        locationId: string;
        delta: number;
      }> = [];
      
      const errors: string[] = [];

      for (const item of items) {
        const detail = originDetails.find(d => d.sku === item.sku);
        if (!detail) {
          errors.push(`SKU ${item.sku} not found at ${origin}`);
          continue;
        }

        // Subtract from origin's On Hand
        originAdjustments.push({
          inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
          locationId: `gid://shopify/Location/${originLocationId}`,
          delta: -item.quantity,
        });

        // For Immediate transfers: also add to destination's On Hand
        if (isImmediate) {
          destAdjustments.push({
            inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
            locationId: `gid://shopify/Location/${destLocationId}`,
            delta: item.quantity,
          });
        }
        // For Air/Sea transfers: incoming is tracked locally in our app, not in Shopify
      }

      if (errors.length > 0 && originAdjustments.length === 0) {
        return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
      }

      try {
        // Step 1: Subtract from origin's On Hand in Shopify
        await adjustInventory(graphqlUrl, accessToken, originAdjustments, 'movement_updated');
        console.log(`✅ Subtracted from origin ${origin}: ${originAdjustments.length} SKUs`);

        // Step 2 (Immediate only): Add to destination's On Hand in Shopify
        if (isImmediate && destAdjustments.length > 0) {
          await adjustInventory(graphqlUrl, accessToken, destAdjustments, 'received');
          console.log(`✅ Added to destination ${destination}: ${destAdjustments.length} SKUs`);
        }

        // Step 3 (Air/Sea only): Add to incoming cache in our app
        if (!isImmediate && (shipmentType === 'Air Express' || shipmentType === 'Air Slow' || shipmentType === 'Sea')) {
          await cacheService.addToIncoming(
            destination,
            shipmentType,
            items,
            transferId,
            new Date().toISOString()
          );
          console.log(`✅ Added to incoming cache: ${items.length} SKUs for ${destination}`);
        }

        console.log(`✅ Transfer ${transferId} Shopify adjustment complete`);
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
        shipmentType,
        isImmediate,
        itemsAdjusted: items.length,
        warnings: errors.length > 0 ? errors : undefined,
      });

    } else if (body.action === 'log_delivery') {
      const { transferId, destination, shipmentType, items } = body;
      
      console.log(`📦 Logging delivery for transfer ${transferId} at ${destination} [${shipmentType}]`);
      
      const destLocationId = locationIds[destination];
      
      if (!destLocationId) {
        return NextResponse.json({ error: `Destination location "${destination}" not found in Shopify` }, { status: 400 });
      }

      // Get inventoryItemIds for each SKU from destination location details
      const destDetails = locationDetails[destination] || [];
      const availableAdjustments: Array<{
        inventoryItemId: string;
        locationId: string;
        delta: number;
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

        // Add to destination's On Hand
        availableAdjustments.push({
          inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
          locationId: `gid://shopify/Location/${destLocationId}`,
          delta: item.quantity,
        });
      }

      if (errors.length > 0 && availableAdjustments.length === 0) {
        return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
      }

      try {
        // Step 1: Add to destination's On Hand in Shopify
        await adjustInventory(graphqlUrl, accessToken, availableAdjustments, 'received');
        console.log(`✅ Added to ${destination} On Hand: ${availableAdjustments.length} SKUs`);

        // Step 2: Subtract from incoming cache in our app (Air/Sea only)
        if (shipmentType === 'Air Express' || shipmentType === 'Air Slow' || shipmentType === 'Sea') {
          await cacheService.subtractFromIncoming(
            destination,
            shipmentType,
            items,
            transferId
          );
          console.log(`✅ Subtracted from incoming cache: ${items.length} SKUs for ${destination}`);
        }

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
