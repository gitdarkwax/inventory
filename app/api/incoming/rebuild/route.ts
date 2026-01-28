/**
 * Rebuild Incoming Inventory Cache
 * Re-reads all in-transit/partial transfers and rebuilds the incoming cache with current ETAs
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { InventoryCacheService, IncomingInventoryCache, IncomingTransferDetail } from '@/lib/inventory-cache';
import { TransfersService } from '@/lib/transfers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔄 Rebuilding incoming inventory cache...');

    // Load all transfers
    const transfersCache = await TransfersService.loadTransfers();
    const transfers = transfersCache.transfers;

    // Filter to only in-transit and partial status transfers
    const activeTransfers = transfers.filter(t => 
      t.status === 'in_transit' || t.status === 'partial'
    );

    console.log(`📦 Found ${activeTransfers.length} active transfers (in_transit or partial)`);

    // Build new incoming inventory cache
    const newIncomingCache: IncomingInventoryCache = {};

    for (const transfer of activeTransfers) {
      const destination = transfer.destination;
      const isAir = transfer.transferType === 'Air Express' || transfer.transferType === 'Air Slow';
      const isSea = transfer.transferType === 'Sea';

      // Skip Immediate transfers (they don't go to incoming)
      if (!isAir && !isSea) continue;

      // Initialize destination if not exists
      if (!newIncomingCache[destination]) {
        newIncomingCache[destination] = {};
      }

      for (const item of transfer.items) {
        // Calculate remaining quantity (total - received)
        const receivedQty = item.receivedQuantity || 0;
        const remainingQty = item.quantity - receivedQty;

        // Skip if fully received
        if (remainingQty <= 0) continue;

        // Initialize SKU entry if not exists
        if (!newIncomingCache[destination][item.sku]) {
          newIncomingCache[destination][item.sku] = {
            inboundAir: 0,
            inboundSea: 0,
            airTransfers: [],
            seaTransfers: [],
          };
        }

        const skuData = newIncomingCache[destination][item.sku];
        
        const transferDetail: IncomingTransferDetail = {
          transferId: transfer.id,
          quantity: remainingQty,
          note: transfer.notes || null,
          createdAt: transfer.createdAt,
          expectedArrivalAt: transfer.eta || null,
        };

        if (isAir) {
          skuData.inboundAir += remainingQty;
          skuData.airTransfers.push(transferDetail);
        } else if (isSea) {
          skuData.inboundSea += remainingQty;
          skuData.seaTransfers.push(transferDetail);
        }
      }
    }

    // Save the rebuilt cache
    const cacheService = new InventoryCacheService();
    await cacheService.setIncomingInventory(newIncomingCache);

    // Calculate stats
    const destinations = Object.keys(newIncomingCache);
    const totalSkus = destinations.reduce((sum, dest) => 
      sum + Object.keys(newIncomingCache[dest] || {}).length, 0
    );
    const transfersWithEta = activeTransfers.filter(t => t.eta).length;

    console.log(`✅ Rebuilt incoming cache: ${totalSkus} SKUs across ${destinations.length} destinations`);
    console.log(`📅 ${transfersWithEta}/${activeTransfers.length} transfers have ETA dates`);

    return NextResponse.json({
      success: true,
      message: 'Incoming inventory cache rebuilt successfully',
      stats: {
        activeTransfers: activeTransfers.length,
        transfersWithEta,
        destinations: destinations.length,
        totalSkus,
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
