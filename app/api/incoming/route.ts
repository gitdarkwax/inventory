/**
 * Incoming Inventory API Route
 * Returns the cached incoming inventory data (from app transfers, not Shopify)
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
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
