/**
 * Incoming Inventory API Route
 * Returns the cached incoming inventory data (from app transfers, not Shopify)
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth, canWrite } from '@/lib/auth';
import { InventoryCacheService } from '@/lib/inventory-cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cacheService = new InventoryCacheService();
    const incomingInventory = await cacheService.getIncomingInventory();

    return NextResponse.json({
      success: true,
      incomingInventory,
    });
  } catch (error) {
    console.error('❌ Failed to get incoming inventory:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// DELETE - Clear a specific SKU from incoming inventory (admin cleanup)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!canWrite(session.user.email)) {
      return NextResponse.json({ error: 'Read-only access' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const sku = searchParams.get('sku');
    
    if (!sku) {
      return NextResponse.json({ error: 'SKU parameter required' }, { status: 400 });
    }

    const cacheService = new InventoryCacheService();
    const incomingInventory = await cacheService.getIncomingInventory();
    
    let removed = false;
    
    // Remove the SKU from all destinations
    for (const destination of Object.keys(incomingInventory)) {
      if (incomingInventory[destination][sku]) {
        const skuData = incomingInventory[destination][sku];
        console.log(`Removing ${sku} from ${destination}: Air=${skuData.inboundAir}, Sea=${skuData.inboundSea}`);
        delete incomingInventory[destination][sku];
        removed = true;
        
        // Clean up empty destination
        if (Object.keys(incomingInventory[destination]).length === 0) {
          delete incomingInventory[destination];
        }
      }
    }
    
    if (!removed) {
      return NextResponse.json({ 
        success: false, 
        message: `SKU ${sku} not found in incoming inventory` 
      });
    }
    
    // Save updated cache
    await cacheService.setIncomingInventory(incomingInventory);
    
    return NextResponse.json({ 
      success: true, 
      message: `Cleared incoming inventory for SKU ${sku}` 
    });
  } catch (error) {
    console.error('❌ Failed to clear SKU from incoming:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
