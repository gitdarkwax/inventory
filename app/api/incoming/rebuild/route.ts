/**
 * One-time endpoint to rebuild incoming inventory cache from in-transit transfers
 * This repopulates the In Air/In Sea data based on transfers currently in transit
 * 
 * IMPROVED: Builds entire incoming inventory in memory first, then saves once
 * This is more reliable than multiple individual saves
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { InventoryCacheService, IncomingInventoryCache } from '@/lib/inventory-cache';
import { TransfersService } from '@/lib/transfers';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load all transfers
    const transfersCache = await TransfersService.loadTransfers();
    const transfers = transfersCache.transfers;

    // Filter to only in-transit or partial transfers with Air or Sea shipment types
    const inTransitTransfers = transfers.filter(t => 
      (t.status === 'in_transit' || t.status === 'partial') && 
      (t.transferType === 'Air Express' || t.transferType === 'Air Slow' || t.transferType === 'Sea')
    );

    console.log(`📦 Found ${inTransitTransfers.length} in-transit/partial transfers to rebuild incoming cache`);

    if (inTransitTransfers.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No in-transit transfers found to rebuild',
        transfersProcessed: 0,
      });
    }

    // Build the entire incoming inventory in memory first
    const incomingInventory: IncomingInventoryCache = {};
    let totalSkus = 0;
    const processedTransfers: string[] = [];

    for (const transfer of inTransitTransfers) {
      // Calculate remaining quantities (quantity - receivedQuantity for partial deliveries)
      const itemsToAdd = transfer.items.map(item => ({
        sku: item.sku,
        quantity: item.quantity - (item.receivedQuantity || 0),
      })).filter(item => item.quantity > 0);

      if (itemsToAdd.length === 0) {
        console.log(`⏭️ Skipping ${transfer.id} - all items already received`);
        continue;
      }

      const isAir = transfer.transferType === 'Air Express' || transfer.transferType === 'Air Slow';
      const isSea = transfer.transferType === 'Sea';
      const destination = transfer.destination;

      // Initialize destination if needed
      if (!incomingInventory[destination]) {
        incomingInventory[destination] = {};
      }

      for (const item of itemsToAdd) {
        // Initialize SKU if needed
        if (!incomingInventory[destination][item.sku]) {
          incomingInventory[destination][item.sku] = {
            inboundAir: 0,
            inboundSea: 0,
            airTransfers: [],
            seaTransfers: [],
          };
        }

        const skuData = incomingInventory[destination][item.sku];
        const transferDetail = {
          transferId: transfer.id,
          quantity: item.quantity,
          note: transfer.notes || null,
          createdAt: transfer.createdAt,
        };

        if (isAir) {
          skuData.inboundAir += item.quantity;
          skuData.airTransfers.push(transferDetail);
        } else if (isSea) {
          skuData.inboundSea += item.quantity;
          skuData.seaTransfers.push(transferDetail);
        }
      }

      totalSkus += itemsToAdd.length;
      processedTransfers.push(transfer.id);
      console.log(`📝 Processed ${transfer.id}: ${itemsToAdd.length} SKUs to ${destination} (${transfer.transferType})`);
    }

    // Now save the entire incoming inventory at once
    const cacheService = new InventoryCacheService();
    await cacheService.setIncomingInventory(incomingInventory);

    // Verify it was saved by reading it back
    const savedIncoming = await cacheService.getIncomingInventory();
    const savedDestinations = Object.keys(savedIncoming);
    const savedSkus = savedDestinations.reduce((sum, dest) => sum + Object.keys(savedIncoming[dest] || {}).length, 0);

    return NextResponse.json({
      success: true,
      message: `Rebuilt incoming cache from ${processedTransfers.length} in-transit transfers`,
      transfersProcessed: processedTransfers.length,
      transferIds: processedTransfers,
      totalSkusAdded: totalSkus,
      verified: {
        destinations: savedDestinations.length,
        skus: savedSkus,
      },
    });

  } catch (error) {
    console.error('❌ Failed to rebuild incoming cache:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
