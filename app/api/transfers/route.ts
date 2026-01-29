/**
 * Transfers API Route
 * CRUD operations for inventory transfers between locations
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth, canWrite } from '@/lib/auth';
import { TransfersService, CarrierType, TransferType } from '@/lib/transfers';
import { InventoryCacheService } from '@/lib/inventory-cache';
import { SlackService, sendSlackNotification } from '@/lib/slack';

export const dynamic = 'force-dynamic';

// GET - List all transfers
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cache = await TransfersService.loadTransfers();
    
    return NextResponse.json({
      transfers: cache.transfers,
      lastUpdated: cache.lastUpdated,
    });

  } catch (error) {
    console.error('Transfers GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transfers' },
      { status: 500 }
    );
  }
}

// POST - Create new transfer
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check write access
    if (!canWrite(session.user.email)) {
      return NextResponse.json({ error: 'Read-only access. You do not have permission to create transfers.' }, { status: 403 });
    }

    const body = await request.json();
    const { origin, destination, transferType, items, carrier, trackingNumber, eta, notes } = body as { 
      origin: string;
      destination: string;
      transferType: TransferType;
      items: { sku: string; quantity: number }[]; 
      carrier?: CarrierType;
      trackingNumber?: string;
      eta?: string;
      notes?: string;
    };

    // Validate required fields
    if (!origin) {
      return NextResponse.json(
        { error: 'Origin is required' },
        { status: 400 }
      );
    }

    if (!destination) {
      return NextResponse.json(
        { error: 'Destination is required' },
        { status: 400 }
      );
    }

    if (!transferType) {
      return NextResponse.json(
        { error: 'Transfer Type is required' },
        { status: 400 }
      );
    }

    const validTransferTypes: TransferType[] = ['Air Express', 'Air Slow', 'Sea', 'Immediate'];
    if (!validTransferTypes.includes(transferType)) {
      return NextResponse.json(
        { error: 'Invalid transfer type. Must be: Air Express, Air Slow, Sea, or Immediate' },
        { status: 400 }
      );
    }

    if (origin === destination) {
      return NextResponse.json(
        { error: 'Origin and destination cannot be the same' },
        { status: 400 }
      );
    }

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

    // Stock validation is done when marking in transit, not during creation
    // This allows users to always create draft transfers

    const newTransfer = await TransfersService.createTransfer(
      origin,
      destination,
      transferType,
      items,
      session.user.name || 'Unknown',
      session.user.email || 'unknown@example.com',
      carrier,
      trackingNumber,
      eta,
      notes
    );

    return NextResponse.json({ transfer: newTransfer }, { status: 201 });

  } catch (error) {
    console.error('Transfers POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create transfer' },
      { status: 500 }
    );
  }
}

// PATCH - Update transfer
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check write access
    if (!canWrite(session.user.email)) {
      return NextResponse.json({ error: 'Read-only access. You do not have permission to update transfers.' }, { status: 403 });
    }

    const body = await request.json();
    const { transferId, origin, destination, transferType, items, carrier, trackingNumber, eta, notes, status, restockedItems } = body as {
      transferId: string;
      origin?: string;
      destination?: string;
      transferType?: TransferType;
      items?: { sku: string; quantity: number; receivedQuantity?: number }[];
      restockedItems?: { sku: string; quantity: number }[];
      carrier?: CarrierType;
      trackingNumber?: string;
      eta?: string;
      notes?: string;
      status?: 'draft' | 'in_transit' | 'partial' | 'delivered' | 'cancelled';
    };

    if (!transferId) {
      return NextResponse.json(
        { error: 'Transfer ID is required' },
        { status: 400 }
      );
    }

    // Validate origin and destination if both provided
    if (origin && destination && origin === destination) {
      return NextResponse.json(
        { error: 'Origin and destination cannot be the same' },
        { status: 400 }
      );
    }

    const userName = session.user.name || 'Unknown';
    const userEmail = session.user.email || 'unknown@example.com';

    // Get the transfer before update to detect status changes
    const transfersBefore = await TransfersService.loadTransfers();
    const transferBefore = transfersBefore.transfers.find(t => t.id === transferId);
    const previousStatus = transferBefore?.status;

    const updatedTransfer = await TransfersService.updateTransfer(
      transferId, 
      {
        origin,
        destination,
        transferType,
        items,
        carrier,
        trackingNumber,
        eta,
        notes,
        status,
      },
      userName,
      userEmail
    );

    if (!updatedTransfer) {
      return NextResponse.json(
        { error: 'Transfer not found' },
        { status: 404 }
      );
    }

    // Send Slack notification when transfer is marked in transit
    const isMarkedInTransit = status === 'in_transit' && previousStatus !== 'in_transit';
    
    if (isMarkedInTransit) {
      sendSlackNotification(async () => {
        const slack = new SlackService();
        await slack.notifyTransferInTransit({
          transferId: updatedTransfer.id,
          markedBy: userName,
          origin: updatedTransfer.origin,
          destination: updatedTransfer.destination,
          shipmentType: updatedTransfer.transferType || 'Unknown',
          carrier: updatedTransfer.carrier,
          trackingNumber: updatedTransfer.trackingNumber,
          eta: updatedTransfer.eta || null,
          items: updatedTransfer.items.map(item => ({
            sku: item.sku,
            quantity: item.quantity,
          })),
        });
      });
    }

    // Send Slack notification if delivery was logged (status changed to partial or delivered)
    const isDeliveryLogged = (status === 'partial' || status === 'delivered') && 
                             previousStatus !== status &&
                             previousStatus !== 'delivered';
    
    if (isDeliveryLogged) {
      sendSlackNotification(async () => {
        const slack = new SlackService();
        
        // Build items with delivery progress for Slack notification
        const itemsWithProgress = updatedTransfer.items.map(item => ({
          sku: item.sku,
          totalQty: item.quantity,
          delivered: item.receivedQuantity || 0,
          pending: item.quantity - (item.receivedQuantity || 0),
        }));

        await slack.notifyTransferDelivery({
          transferId: updatedTransfer.id,
          status: updatedTransfer.status === 'delivered' ? 'delivered' : 'partial',
          receivedBy: userName,
          origin: updatedTransfer.origin,
          destination: updatedTransfer.destination,
          shipmentType: updatedTransfer.transferType || 'Unknown',
          carrier: updatedTransfer.carrier,
          trackingNumber: updatedTransfer.trackingNumber,
          items: itemsWithProgress,
        });
      });
    }

    // Send Slack notification if transfer was cancelled
    if (status === 'cancelled' && previousStatus !== 'cancelled') {
      sendSlackNotification(async () => {
        const slack = new SlackService();
        await slack.notifyTransferCancelled({
          transferId: updatedTransfer.id,
          cancelledBy: userName,
          origin: updatedTransfer.origin,
          destination: updatedTransfer.destination,
          shipmentType: updatedTransfer.transferType || 'Unknown',
          items: updatedTransfer.items.map(item => ({
            sku: item.sku,
            quantity: item.quantity,
          })),
          restockedItems: restockedItems,
        });
      });
    }

    return NextResponse.json({ transfer: updatedTransfer });

  } catch (error) {
    console.error('Transfers PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update transfer' },
      { status: 500 }
    );
  }
}
