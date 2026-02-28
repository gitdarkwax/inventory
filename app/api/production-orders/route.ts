/**
 * Production Orders API Route
 * CRUD operations for production orders
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth, canWrite } from '@/lib/auth';
import { ProductionOrdersService } from '@/lib/production-orders';
import { SlackService, sendSlackNotification } from '@/lib/slack';

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
    
    // Check write access
    if (!canWrite(session.user.email)) {
      return NextResponse.json({ error: 'Read-only access. You do not have permission to create production orders.' }, { status: 403 });
    }

    const body = await request.json();
    const { items, notes, vendor, eta, poNumber, isNonSku } = body as { 
      items: { sku: string; quantity: number; masterCartons?: number }[]; 
      notes: string;
      vendor?: string;
      eta?: string;
      poNumber?: string;
      isNonSku?: boolean;
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
      eta,
      poNumber,
      isNonSku
    );

    // Send Slack notification (non-blocking)
    sendSlackNotification(async () => {
      const slack = new SlackService(process.env.SLACK_CHANNEL_PRODUCTION!);
      await slack.notifyPOCreated({
        poNumber: newOrder.id,
        createdBy: session.user?.name || 'Unknown',
        vendor: vendor || '',
        eta: eta || null,
        items: items,
      });
    }, 'SLACK_CHANNEL_PRODUCTION');

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
    
    // Check write access
    if (!canWrite(session.user.email)) {
      return NextResponse.json({ error: 'Read-only access. You do not have permission to update production orders.' }, { status: 403 });
    }

    const body = await request.json();
    const { orderId, items, notes, poNumber, vendor, eta, status, deliveries } = body as {
      orderId: string;
      items?: { sku: string; quantity: number }[];
      notes?: string;
      poNumber?: string;
      vendor?: string;
      eta?: string;
      status?: 'in_production' | 'partial' | 'completed' | 'cancelled';
      deliveries?: { sku: string; quantity: number; masterCartons?: number }[];
    };

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    const userName = session.user.name || 'Unknown';
    const userEmail = session.user.email || 'unknown@example.com';

    // If deliveries are provided, log them
    if (deliveries && deliveries.length > 0) {
      // Get the order before update to calculate pending items
      const ordersBefore = await ProductionOrdersService.loadOrders();
      const orderBefore = ordersBefore.orders.find(o => o.id === orderId);
      
      const updatedOrder = await ProductionOrdersService.logDelivery(
        orderId, 
        deliveries,
        userName,
        userEmail
      );
      if (!updatedOrder) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        );
      }

      // Send Slack notification (non-blocking)
      sendSlackNotification(async () => {
        const slack = new SlackService(process.env.SLACK_CHANNEL_PRODUCTION!);
        
        // Calculate pending items
        const pendingItems = updatedOrder.items
          .filter(item => (item.receivedQuantity || 0) < item.quantity)
          .map(item => ({
            sku: item.sku,
            quantity: item.quantity - (item.receivedQuantity || 0),
          }));

        await slack.notifyPODelivery({
          poNumber: updatedOrder.id,
          status: updatedOrder.status === 'completed' ? 'delivered' : 'partial',
          vendor: updatedOrder.vendor || '',
          receivedBy: userName,
          location: 'China WH', // POs are received at China WH
          deliveredItems: deliveries,
          pendingItems: pendingItems.length > 0 ? pendingItems : undefined,
        });
      }, 'SLACK_CHANNEL_PRODUCTION');

      return NextResponse.json({ order: updatedOrder });
    }

    // Get the order before update to detect status changes
    const ordersBefore = await ProductionOrdersService.loadOrders();
    const orderBefore = ordersBefore.orders.find(o => o.id === orderId);
    const previousStatus = orderBefore?.status;

    // Otherwise, update order fields
    const updatedOrder = await ProductionOrdersService.updateOrder(
      orderId, 
      {
        items,
        notes,
        poNumber,
        vendor,
        eta,
        status,
      },
      userName,
      userEmail
    );

    if (!updatedOrder) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    // Send Slack notification if order was cancelled (skip for in_production - essentially a draft)
    if (status === 'cancelled' && previousStatus !== 'cancelled' && previousStatus !== 'in_production') {
      sendSlackNotification(async () => {
        const slack = new SlackService(process.env.SLACK_CHANNEL_PRODUCTION!);
        await slack.notifyPOCancelled({
          poNumber: updatedOrder.id,
          cancelledBy: userName,
          vendor: updatedOrder.vendor || '',
          items: updatedOrder.items.map(item => ({
            sku: item.sku,
            quantity: item.quantity,
          })),
        });
      }, 'SLACK_CHANNEL_PRODUCTION');
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

// DELETE - Permanently remove production orders by ID (e.g. test data cleanup)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!canWrite(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden. Write access required to delete production orders.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { orderIds } = body as { orderIds?: string[] };
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: 'Request body must include orderIds: string[]' },
        { status: 400 }
      );
    }

    const cache = await ProductionOrdersService.loadOrders();
    const idsToRemove = new Set(orderIds.map((id: string) => String(id)));
    const removed = cache.orders.filter(o => idsToRemove.has(o.id));
    const kept = cache.orders.filter(o => !idsToRemove.has(o.id));

    if (removed.length === 0) {
      return NextResponse.json({
        message: 'No matching production orders found to delete',
        deletedCount: 0,
        orders: cache.orders,
      });
    }

    cache.orders = kept;
    cache.lastUpdated = new Date().toISOString();
    await ProductionOrdersService.saveOrders(cache);

    return NextResponse.json({
      message: `Permanently deleted ${removed.length} production order(s)`,
      deletedCount: removed.length,
      deletedIds: removed.map(o => o.id),
      orders: kept,
    });
  } catch (error) {
    console.error('Production Orders DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete production orders' },
      { status: 500 }
    );
  }
}
