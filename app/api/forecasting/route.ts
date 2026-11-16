/**
 * Forecasting API Route
 * Serves cached forecasting data - use /api/refresh to update
 */

import { NextResponse } from 'next/server';
import { InventoryCacheService } from '@/lib/inventory-cache';
import { requireApiActor } from '@/lib/api-actor';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // Signed-in users (any role) or the agent bearer key only.
    const result = await requireApiActor(request);
    if (!result.ok) return result.response;

    const cache = new InventoryCacheService();
    const cachedData = await cache.loadCache();

    if (!cachedData) {
      return NextResponse.json(
        { 
          error: 'No cached data available',
          message: 'Please click the Refresh button to load forecasting data.',
        },
        { status: 503 }
      );
    }

    // Return cached forecasting data with metadata
    return NextResponse.json({
      ...cachedData.forecasting,
      cache: {
        lastUpdated: cachedData.lastUpdated,
        age: `${Math.floor((Date.now() - new Date(cachedData.lastUpdated).getTime()) / 1000 / 60)} minutes`,
      },
    });

  } catch (error) {
    console.error('Forecasting API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch forecasting data' },
      { status: 500 }
    );
  }
}
