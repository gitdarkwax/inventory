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
import { InventoryCacheService, IncomingInventoryCache } from '@/lib/inventory-cache';
import { TransfersService } from '@/lib/transfers';

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
  note?: string | null;
  expectedArrivalAt?: string | null;
}

interface LogDeliveryRequest {
  action: 'log_delivery';
  transferId: string;
  destination: string;
  shipmentType: ShipmentType; // Needed to know which incoming column to subtract from
  items: { sku: string; quantity: number }[]; // quantity being delivered
}

interface RestockCancelledRequest {
  action: 'restock_cancelled';
  transferId: string;
  origin: string;
  items: { sku: string; quantity: number }[]; // undelivered items to restock
}

interface RebuildIncomingRequest {
  action: 'rebuild_incoming';
}

type RequestBody = MarkInTransitRequest | LogDeliveryRequest | RestockCancelledRequest | RebuildIncomingRequest;

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
      // ShipBob manages its own inventory - skip Shopify destination update for ShipBob
      // Distributor is an external destination - only subtract from origin, no destination update
      const isShipBobDestination = destination === 'ShipBob';
      const isDistributorDestination = destination === 'Distributor';
      const skipDestinationUpdate = isShipBobDestination || isDistributorDestination;
      
      console.log(`📦 ${isImmediate ? 'Processing immediate transfer' : 'Marking transfer in transit'} ${transferId}: ${origin} → ${destination} [${shipmentType}]`);
      if (isShipBobDestination && isImmediate) {
        console.log(`📦 ShipBob destination - will only subtract from origin (ShipBob syncs separately)`);
      }
      if (isDistributorDestination && isImmediate) {
        console.log(`📦 Distributor destination - will only subtract from origin (external transfer)`);
      }
      
      const originLocationId = locationIds[origin];
      const destLocationId = locationIds[destination];
      
      if (!originLocationId) {
        return NextResponse.json({ error: `Origin location "${origin}" not found in Shopify` }, { status: 400 });
      }
      // Only require dest location ID if we're going to use it (immediate + not ShipBob/Distributor)
      if (!destLocationId && isImmediate && !skipDestinationUpdate) {
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

        // For Immediate transfers: add to destination's On Hand (skip ShipBob/Distributor)
        if (isImmediate && !skipDestinationUpdate) {
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

        // Step 2 (Immediate only, skip ShipBob/Distributor): Add to destination's On Hand in Shopify
        if (isImmediate && destAdjustments.length > 0 && !skipDestinationUpdate) {
          await adjustInventory(graphqlUrl, accessToken, destAdjustments, 'received');
          console.log(`✅ Added to destination ${destination}: ${destAdjustments.length} SKUs`);
        } else if (isImmediate && skipDestinationUpdate) {
          console.log(`⏭️ Skipped ${destination} destination Shopify update (external/3PL)`);
        }

        // Step 3 (Air/Sea only): Add to incoming cache in our app
        if (!isImmediate && (shipmentType === 'Air Express' || shipmentType === 'Air Slow' || shipmentType === 'Sea')) {
          const { note, expectedArrivalAt } = body as MarkInTransitRequest;
          await cacheService.addToIncoming(
            destination,
            shipmentType,
            items,
            transferId,
            new Date().toISOString(),
            note,
            expectedArrivalAt
          );
          console.log(`✅ Added to incoming cache: ${items.length} SKUs for ${destination}${expectedArrivalAt ? ` (ETA: ${expectedArrivalAt})` : ''}`);
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
      
      // ShipBob manages its own inventory - skip Shopify update for ShipBob destination
      const isShipBob = destination === 'ShipBob';
      
      if (isShipBob) {
        console.log(`📦 ShipBob destination - skipping Shopify On Hand update (ShipBob syncs separately)`);
      }

      const errors: string[] = [];

      try {
        // Step 1: Add to destination's On Hand in Shopify (skip for ShipBob)
        if (!isShipBob) {
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

          await adjustInventory(graphqlUrl, accessToken, availableAdjustments, 'received');
          console.log(`✅ Added to ${destination} On Hand: ${availableAdjustments.length} SKUs`);
        }

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
        skippedShopify: isShipBob,
        warnings: errors.length > 0 ? errors : undefined,
      });

    } else if (body.action === 'restock_cancelled') {
      // Restock undelivered items to origin when cancelling a partial delivery
      const { transferId, origin, items } = body;
      
      console.log(`📦 Restocking ${items.length} SKUs to ${origin} for cancelled transfer ${transferId}`);
      
      const errors: string[] = [];

      try {
        const originLocationId = locationIds[origin];
        
        if (!originLocationId) {
          return NextResponse.json({ error: `Origin location "${origin}" not found in Shopify` }, { status: 400 });
        }

        // Get inventoryItemIds for each SKU
        const originDetails = locationDetails[origin] || [];
        const availableAdjustments: Array<{
          inventoryItemId: string;
          locationId: string;
          delta: number;
        }> = [];

        for (const item of items) {
          let detail = originDetails.find(d => d.sku === item.sku);
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

          // Add back to origin's On Hand
          availableAdjustments.push({
            inventoryItemId: `gid://shopify/InventoryItem/${detail.inventoryItemId}`,
            locationId: `gid://shopify/Location/${originLocationId}`,
            delta: item.quantity,
          });
        }

        if (errors.length > 0 && availableAdjustments.length === 0) {
          return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
        }

        await adjustInventory(graphqlUrl, accessToken, availableAdjustments, 'restock');
        console.log(`✅ Restocked to ${origin} On Hand: ${availableAdjustments.length} SKUs`);

        console.log(`✅ Restock completed for cancelled transfer ${transferId}`);
      } catch (error) {
        console.error('❌ Shopify restock failed:', error);
        return NextResponse.json({ 
          error: 'Failed to restock inventory to origin', 
          details: error instanceof Error ? error.message : 'Unknown error',
          partialErrors: errors.length > 0 ? errors : undefined,
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        action: 'restock_cancelled',
        transferId,
        itemsRestocked: items.length,
        warnings: errors.length > 0 ? errors : undefined,
      });

    } else if (body.action === 'rebuild_incoming') {
      // Rebuild incoming cache from all in_transit and partial transfers
      console.log(`📦 Rebuilding incoming inventory cache from all transfers`);
      
      try {
        const transfersCache = await TransfersService.loadTransfers();
        const activeTransfers = transfersCache.transfers.filter(
          t => t.status === 'in_transit' || t.status === 'partial'
        );
        
        // Build new incoming inventory from scratch
        const newIncoming: IncomingInventoryCache = {};
        
        for (const transfer of activeTransfers) {
          // Skip Immediate transfers (they don't contribute to incoming)
          if (transfer.transferType === 'Immediate') continue;
          
          const destination = transfer.destination;
          const isAir = transfer.transferType === 'Air Express' || transfer.transferType === 'Air Slow';
          const isSea = transfer.transferType === 'Sea';
          
          if (!isAir && !isSea) continue;
          
          if (!newIncoming[destination]) {
            newIncoming[destination] = {};
          }
          
          for (const item of transfer.items) {
            // Calculate remaining quantity (total minus already received)
            const remainingQty = item.quantity - (item.receivedQuantity || 0);
            if (remainingQty <= 0) continue;
            
            if (!newIncoming[destination][item.sku]) {
              newIncoming[destination][item.sku] = {
                inboundAir: 0,
                inboundSea: 0,
                airTransfers: [],
                seaTransfers: [],
              };
            }
            
            const transferDetail = {
              transferId: transfer.id,
              quantity: remainingQty,
              createdAt: transfer.createdAt,
              note: transfer.notes || null,
              expectedArrivalAt: transfer.eta || null,
            };
            
            if (isAir) {
              newIncoming[destination][item.sku].inboundAir += remainingQty;
              newIncoming[destination][item.sku].airTransfers.push(transferDetail);
            } else if (isSea) {
              newIncoming[destination][item.sku].inboundSea += remainingQty;
              newIncoming[destination][item.sku].seaTransfers.push(transferDetail);
            }
          }
        }
        
        // Save the rebuilt cache
        await cacheService.setIncomingInventory(newIncoming);
        
        const totalSkus = Object.values(newIncoming).reduce(
          (sum, dest) => sum + Object.keys(dest).length, 0
        );
        console.log(`✅ Incoming cache rebuilt: ${activeTransfers.length} active transfers, ${totalSkus} SKUs`);
        
        return NextResponse.json({
          success: true,
          action: 'rebuild_incoming',
          transfersProcessed: activeTransfers.length,
          skusTracked: totalSkus,
        });
      } catch (error) {
        console.error('❌ Failed to rebuild incoming cache:', error);
        return NextResponse.json({ 
          error: 'Failed to rebuild incoming cache', 
          details: error instanceof Error ? error.message : 'Unknown error',
        }, { status: 500 });
      }
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
