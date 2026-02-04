import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { HiddenSkusService } from '@/lib/hidden-skus';

export const dynamic = 'force-dynamic';

/**
 * GET - Get all hidden SKUs for inventory counts
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cache = await HiddenSkusService.getHiddenSKUs();
    return NextResponse.json(cache);
  } catch (error) {
    console.error('Error fetching hidden SKUs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch hidden SKUs' },
      { status: 500 }
    );
  }
}

/**
 * POST - Add SKU to hidden list
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

    const cache = await HiddenSkusService.addSKU(
      sku,
      session.user.name || 'Unknown',
      session.user.email || 'unknown@example.com'
    );

    return NextResponse.json(cache);
  } catch (error) {
    console.error('Error adding hidden SKU:', error);
    return NextResponse.json(
      { error: 'Failed to add SKU to hidden list' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove SKU from hidden list
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

    const cache = await HiddenSkusService.removeSKU(sku);
    return NextResponse.json(cache);
  } catch (error) {
    console.error('Error removing hidden SKU:', error);
    return NextResponse.json(
      { error: 'Failed to remove SKU from hidden list' },
      { status: 500 }
    );
  }
}
