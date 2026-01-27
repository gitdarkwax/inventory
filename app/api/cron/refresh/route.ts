/**
 * Cron API Route - Hourly Auto Refresh
 * This route is called by Vercel Cron to refresh inventory data every hour
 * 
 * IMPORTANT: This directly calls the refresh logic to ensure identical
 * behavior between manual and automatic refreshes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { InventoryCacheService } from '@/lib/inventory-cache';
import { fetchInventoryData, fetchForecastingData } from '@/app/api/refresh/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request from Vercel
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (!cronSecret) {
      console.error('❌ CRON_SECRET not configured');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }
    
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.error('❌ Invalid cron authorization');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🕐 Starting hourly cron refresh...');
    const startTime = Date.now();

    // Fetch inventory data directly (same logic as /api/refresh)
    const inventoryData = await fetchInventoryData();
    console.log(`✅ Inventory data fetched: ${inventoryData.totalSKUs} SKUs`);

    // Fetch forecasting data
    const rawForecastingData = await fetchForecastingData();
    console.log(`✅ Forecasting data fetched: ${rawForecastingData.length} SKUs`);

    // Build SKU to product name map from inventory data
    const skuToProductName = new Map<string, string>();
    for (const item of inventoryData.inventory) {
      skuToProductName.set(item.sku, item.productTitle);
    }

    // Enrich forecasting data with product names from inventory
    const forecastingData = rawForecastingData.map(item => ({
      ...item,
      productName: item.productName || skuToProductName.get(item.sku) || '',
    }));

    // Save to cache (this preserves incomingInventory)
    const cache = new InventoryCacheService();
    await cache.saveCache({
      inventory: inventoryData,
      forecasting: { forecasting: forecastingData },
    }, 'hourly auto refresh');

    const duration = Date.now() - startTime;
    console.log(`✅ Hourly cron refresh complete in ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: 'Hourly refresh completed',
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      data: {
        inventory: {
          totalSKUs: inventoryData.totalSKUs,
          totalUnits: inventoryData.totalUnits,
          locations: inventoryData.locations.length,
        },
        forecasting: {
          totalSKUs: forecastingData.length,
        },
      },
    });
  } catch (error) {
    console.error('❌ Cron refresh failed:', error);
    return NextResponse.json(
      { error: 'Cron refresh failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
