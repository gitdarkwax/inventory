import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SkuCommentsService } from '@/lib/sku-comments';

export const dynamic = 'force-dynamic';

/**
 * GET - Get all SKU comments
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cache = await SkuCommentsService.getComments();
    return NextResponse.json(cache);
  } catch (error) {
    console.error('Error fetching SKU comments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SKU comments' },
      { status: 500 }
    );
  }
}

/**
 * POST - Add or update a comment for a SKU
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { sku, comment } = body;

    if (!sku || typeof sku !== 'string') {
      return NextResponse.json(
        { error: 'SKU is required' },
        { status: 400 }
      );
    }

    if (typeof comment !== 'string') {
      return NextResponse.json(
        { error: 'Comment must be a string' },
        { status: 400 }
      );
    }

    const cache = await SkuCommentsService.setComment(
      sku,
      comment,
      session.user.name || 'Unknown',
      session.user.email || 'unknown@example.com'
    );

    return NextResponse.json(cache);
  } catch (error) {
    console.error('Error saving SKU comment:', error);
    return NextResponse.json(
      { error: 'Failed to save SKU comment' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove comment for a SKU
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

    const cache = await SkuCommentsService.deleteComment(sku);
    return NextResponse.json(cache);
  } catch (error) {
    console.error('Error deleting SKU comment:', error);
    return NextResponse.json(
      { error: 'Failed to delete SKU comment' },
      { status: 500 }
    );
  }
}
