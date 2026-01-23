import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { PhaseOutService } from '@/lib/phase-out-skus';

export const dynamic = 'force-dynamic';

/**
 * GET - Get all phase out SKUs
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cache = await PhaseOutService.getPhaseOutSKUs();
    return NextResponse.json(cache);
  } catch (error) {
    console.error('Error fetching phase out SKUs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch phase out SKUs' },
      { status: 500 }
    );
  }
}

/**
 * POST - Add SKU to phase out list
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { sku } = body;

    if (!sku || typeof sku !== 'string') {
      return NextResponse.json(
        { error: 'SKU is required' },
        { status: 400 }
      );
    }

    const cache = await PhaseOutService.addSKU(
      sku,
      session.user.name || 'Unknown',
      session.user.email || 'unknown@example.com'
    );

    return NextResponse.json(cache);
  } catch (error) {
    console.error('Error adding phase out SKU:', error);
    return NextResponse.json(
      { error: 'Failed to add SKU to phase out list' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove SKU from phase out list
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sku = searchParams.get('sku');

    if (!sku) {
      return NextResponse.json(
        { error: 'SKU is required' },
        { status: 400 }
      );
    }

    const cache = await PhaseOutService.removeSKU(sku);
    return NextResponse.json(cache);
  } catch (error) {
    console.error('Error removing phase out SKU:', error);
    return NextResponse.json(
      { error: 'Failed to remove SKU from phase out list' },
      { status: 500 }
    );
  }
}
