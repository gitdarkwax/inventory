/**
 * One-time endpoint to rebuild incoming inventory cache from in-transit transfers
 * This repopulates the In Air/In Sea data based on transfers currently in transit
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { InventoryCacheService } from '@/lib/inventory-cache';
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

    // Filter to only in-transit transfers with Air or Sea shipment types
    const inTransitTransfers = transfers.filter(t => 
      t.status === 'in_transit' && 
      (t.transferType === 'Air Express' || t.transferType === 'Air Slow' || t.transferType === 'Sea')
    );

    console.log(`📦 Found ${inTransitTransfers.length} in-transit transfers to rebuild incoming cache`);

    if (inTransitTransfers.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No in-transit transfers found to rebuild',
        transfersProcessed: 0,
      });
    }

    // Load cache service
    const cacheService = new InventoryCacheService();
    
    // Process each in-transit transfer
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

      await cacheService.addToIncoming(
        transfer.destination,
        transfer.transferType as 'Air Express' | 'Air Slow' | 'Sea',
        itemsToAdd,
        transfer.id,
        transfer.createdAt,
        transfer.notes
      );

      totalSkus += itemsToAdd.length;
      processedTransfers.push(transfer.id);
      console.log(`✅ Added ${transfer.id}: ${itemsToAdd.length} SKUs to ${transfer.destination} (${transfer.transferType})`);
    }

    return NextResponse.json({
      success: true,
      message: `Rebuilt incoming cache from ${processedTransfers.length} in-transit transfers`,
      transfersProcessed: processedTransfers.length,
      transferIds: processedTransfers,
      totalSkusAdded: totalSkus,
    });

  } catch (error) {
    console.error('❌ Failed to rebuild incoming cache:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
