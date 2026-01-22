/**
 * Forecasting API Route
 * Fetches sales velocity data for inventory forecasting
 */

import { NextResponse } from 'next/server';
import { ShopifyQLService } from '@/lib/shopifyql';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const shopifyQL = new ShopifyQLService();
    const forecastingData = await shopifyQL.getForecastingData();

    return NextResponse.json({
      forecasting: forecastingData,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to fetch forecasting data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch forecasting data' },
      { status: 500 }
    );
  }
}
