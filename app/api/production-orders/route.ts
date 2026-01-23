/**
 * Production Orders API Route
 * CRUD operations for production orders
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ProductionOrdersService } from '@/lib/production-orders';

export const dynamic = 'force-dynamic';

// GET - List all production orders
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cache = await ProductionOrdersService.loadOrders();
    
    return NextResponse.json({
      orders: cache.orders,
      lastUpdated: cache.lastUpdated,
    });

  } catch (error) {
    console.error('Production Orders GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch production orders' },
      { status: 500 }
    );
  }
}

// POST - Create new production order
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { items, notes, vendor, eta } = body as { 
      items: { sku: string; quantity: number }[]; 
      notes: string;
      vendor?: string;
      eta?: string;
    };

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'At least one item is required' },
        { status: 400 }
      );
    }

    // Validate items
    for (const item of items) {
      if (!item.sku || typeof item.quantity !== 'number' || item.quantity <= 0) {
        return NextResponse.json(
          { error: 'Each item must have a valid SKU and positive quantity' },
          { status: 400 }
        );
      }
    }

    const newOrder = await ProductionOrdersService.createOrder(
      items,
      notes || '',
      session.user.name || 'Unknown',
      session.user.email || 'unknown@example.com',
      vendor,
      eta
    );

    return NextResponse.json({ order: newOrder }, { status: 201 });

  } catch (error) {
    console.error('Production Orders POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create production order' },
      { status: 500 }
    );
  }
}

// PATCH - Update production order or log delivery
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orderId, items, notes, vendor, eta, status, deliveries } = body as {
      orderId: string;
      items?: { sku: string; quantity: number }[];
      notes?: string;
      vendor?: string;
      eta?: string;
      status?: 'in_production' | 'partial' | 'completed' | 'cancelled';
      deliveries?: { sku: string; quantity: number }[];
    };

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    // If deliveries are provided, log them
    if (deliveries && deliveries.length > 0) {
      const updatedOrder = await ProductionOrdersService.logDelivery(orderId, deliveries);
      if (!updatedOrder) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ order: updatedOrder });
    }

    // Otherwise, update order fields
    const updatedOrder = await ProductionOrdersService.updateOrder(orderId, {
      items,
      notes,
      vendor,
      eta,
      status,
    });

    if (!updatedOrder) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ order: updatedOrder });

  } catch (error) {
    console.error('Production Orders PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update production order' },
      { status: 500 }
    );
  }
}
