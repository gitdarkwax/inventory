/**
 * Inventory API Route
 * Serves cached inventory data - use /api/refresh to update
 */

import { NextResponse } from 'next/server';
import { InventoryCacheService } from '@/lib/inventory-cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cache = new InventoryCacheService();
    const cachedData = await cache.loadCache();

    if (!cachedData) {
      return NextResponse.json(
        { 
          error: 'No cached data available',
          message: 'Please click the Refresh button to load inventory data.',
        },
        { status: 503 }
      );
    }

    // Return cached inventory data with metadata
    return NextResponse.json({
      ...cachedData.inventory,
      lastUpdated: cachedData.lastUpdated,
      refreshedBy: cachedData.refreshedBy,
      cache: {
        lastUpdated: cachedData.lastUpdated,
        refreshedBy: cachedData.refreshedBy,
        age: `${Math.floor((Date.now() - new Date(cachedData.lastUpdated).getTime()) / 1000 / 60)} minutes`,
      },
    });

  } catch (error) {
    console.error('Inventory API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory' },
      { status: 500 }
    );
  }
}
