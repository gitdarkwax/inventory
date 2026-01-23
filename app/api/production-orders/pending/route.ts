/**
 * Pending Production Orders API Route
 * Returns aggregated pending quantities by SKU
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ProductionOrdersService } from '@/lib/production-orders';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
