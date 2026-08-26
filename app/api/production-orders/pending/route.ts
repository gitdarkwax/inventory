/**
 * Pending Production Orders API Route
 * Returns aggregated pending quantities by SKU
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiActor } from '@/lib/api-actor';
import { ProductionOrdersService } from '@/lib/production-orders';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const result = await requireApiActor(request);
    if (!result.ok) return result.response;

    const quantities = await ProductionOrdersService.getPendingQuantitiesBySku();
    
    // Convert Map to array for JSON response
    const pendingBysku = Array.from(quantities.entries()).map(([sku, quantity]) => ({
      sku,
      pendingQuantity: quantity,
    }));

    return NextResponse.json({ pendingBysku });

  } catch (error) {
    console.error('Pending PO quantities error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pending quantities' },
      { status: 500 }
    );
  }
}
