/**
 * Transfers API Route
 * CRUD operations for inventory transfers between locations
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth, canWrite } from '@/lib/auth';
import { TransfersService, CarrierType, TransferType } from '@/lib/transfers';
import { InventoryCacheService } from '@/lib/inventory-cache';
import { SlackService, sendSlackNotification } from '@/lib/slack';

// Note: InventoryCacheService is used for updating incoming inventory when transfers are cancelled

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
    const { transferId, origin, destination, transferType, items, carrier, trackingNumber, eta, notes, status, restockedItems, receivedItems } = body as {
      transferId: string;
      origin?: string;
      destination?: string;
      transferType?: TransferType;
      items?: { sku: string; quantity: number; receivedQuantity?: number }[];
      restockedItems?: { sku: string; quantity: number }[];
      receivedItems?: { sku: string; quantity: number }[];
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

    // If receivedItems provided, merge with existing items to set receivedQuantity
    let itemsToUpdate = items;
    if (receivedItems && receivedItems.length > 0) {
      // Get existing items from the transfer
      const existingTransfer = transfersBefore.transfers.find(t => t.id === transferId);
      if (existingTransfer) {
        itemsToUpdate = existingTransfer.items.map(item => {
          const received = receivedItems.find(r => r.sku === item.sku);
          return {
            ...item,
            receivedQuantity: received ? received.quantity : (item.receivedQuantity || 0),
          };
        });
      }
    }

    const updatedTransfer = await TransfersService.updateTransfer(
      transferId, 
      {
        origin,
        destination,
        transferType,
        items: itemsToUpdate,
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
        const slack = new SlackService(process.env.SLACK_CHANNEL_INCOMING!);
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
      }, 'SLACK_CHANNEL_INCOMING');
    }

    // Send Slack notification if delivery was logged (status changed to partial or delivered)
    const isDeliveryLogged = (status === 'partial' || status === 'delivered') && 
                             previousStatus !== status &&
                             previousStatus !== 'delivered';
    
    if (isDeliveryLogged) {
      sendSlackNotification(async () => {
        const slack = new SlackService(process.env.SLACK_CHANNEL_INCOMING!);
        
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
      }, 'SLACK_CHANNEL_INCOMING');
    }

    // Handle transfer cancellation - update incoming inventory cache and notify
    if (status === 'cancelled' && previousStatus !== 'cancelled') {
      // Remove from incoming inventory cache if it was in transit (Air/Sea)
      if (previousStatus === 'in_transit' || previousStatus === 'partial') {
        const shipType = updatedTransfer.transferType;
        if (shipType === 'Air Express' || shipType === 'Air Slow' || shipType === 'Sea') {
          try {
            const cacheService = new InventoryCacheService();
            await cacheService.removeTransferFromIncoming(
              updatedTransfer.destination,
              updatedTransfer.id
            );
            console.log(`✅ Removed cancelled transfer ${updatedTransfer.id} from incoming cache`);
          } catch (err) {
            console.error('Failed to remove cancelled transfer from incoming cache:', err);
          }
        }
      }

      // Send Slack notification (skip for draft transfers - no need to notify)
      if (previousStatus !== 'draft') {
        sendSlackNotification(async () => {
          const slack = new SlackService(process.env.SLACK_CHANNEL_INCOMING!);
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
        }, 'SLACK_CHANNEL_INCOMING');
      }
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

// DELETE - Permanently remove transfers by ID (e.g. test data cleanup)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!canWrite(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden. Write access required to delete transfers.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { transferIds } = body as { transferIds?: string[] };
    if (!Array.isArray(transferIds) || transferIds.length === 0) {
      return NextResponse.json(
        { error: 'Request body must include transferIds: string[]' },
        { status: 400 }
      );
    }

    const cache = await TransfersService.loadTransfers();
    const idsToRemove = new Set(transferIds.map((id: string) => String(id).toUpperCase()));
    const removed = cache.transfers.filter(t => idsToRemove.has(t.id));
    const kept = cache.transfers.filter(t => !idsToRemove.has(t.id));

    if (removed.length === 0) {
      return NextResponse.json({
        message: 'No matching transfers found to delete',
        deletedCount: 0,
        transfers: cache.transfers,
      });
    }

    // Remove deleted transfers from incoming inventory cache if they were in transit or partial
    const cacheService = new InventoryCacheService();
    for (const t of removed) {
      if (t.status === 'in_transit' || t.status === 'partial') {
        try {
          await cacheService.removeTransferFromIncoming(t.destination, t.id);
        } catch (err) {
          console.error(`Failed to remove transfer ${t.id} from incoming cache:`, err);
        }
      }
    }

    cache.transfers = kept;
    cache.lastUpdated = new Date().toISOString();
    await TransfersService.saveTransfers(cache);

    return NextResponse.json({
      message: `Permanently deleted ${removed.length} transfer(s)`,
      deletedCount: removed.length,
      deletedIds: removed.map(t => t.id),
      transfers: kept,
    });
  } catch (error) {
    console.error('Transfers DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete transfers' },
      { status: 500 }
    );
  }
}
