/**
 * Transfers API Route
 * CRUD operations for inventory transfers between locations
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { TransfersService, CarrierType } from '@/lib/transfers';

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

    const body = await request.json();
    const { origin, destination, items, carrier, trackingNumber, eta, notes } = body as { 
      origin: string;
      destination: string;
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

    const newTransfer = await TransfersService.createTransfer(
      origin,
      destination,
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

    const body = await request.json();
    const { transferId, origin, destination, items, carrier, trackingNumber, eta, notes, status } = body as {
      transferId: string;
      origin?: string;
      destination?: string;
      items?: { sku: string; quantity: number; receivedQuantity?: number }[];
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

    const updatedTransfer = await TransfersService.updateTransfer(
      transferId, 
      {
        origin,
        destination,
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

    return NextResponse.json({ transfer: updatedTransfer });

  } catch (error) {
    console.error('Transfers PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update transfer' },
      { status: 500 }
    );
  }
}
