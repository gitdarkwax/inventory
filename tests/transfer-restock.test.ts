/**
 * Cancelling a transfer must give the origin back whatever was subtracted
 * when it was marked in transit and has not been received.
 * Reproduces T0558 (2026-11-20): a duplicate China WH → LA Office Air Express
 * transfer cancelled while in transit left China short 80 / 80 / 50.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { checkRestockRequest, undeliveredItems, type RestockTransfer } from '@/lib/transfer-restock';

const t0558: RestockTransfer = {
  id: 'T0558',
  origin: 'China WH',
  status: 'in_transit',
  items: [
    { sku: 'QIML-BK', quantity: 80 },
    { sku: 'QIML-CH', quantity: 80 },
    { sku: 'ESZF8-BK', quantity: 50 },
  ],
};

describe('undeliveredItems', () => {
  it('returns every line in full for an in-transit transfer', () => {
    expect(undeliveredItems(t0558)).toEqual([
      { sku: 'QIML-BK', quantity: 80 },
      { sku: 'QIML-CH', quantity: 80 },
      { sku: 'ESZF8-BK', quantity: 50 },
    ]);
  });

  it('returns only what is still owed on a partial delivery (unchanged behaviour)', () => {
    const partial: RestockTransfer = {
      ...t0558,
      status: 'partial',
      items: [
        { sku: 'QIML-BK', quantity: 80, receivedQuantity: 80 },
        { sku: 'QIML-CH', quantity: 80, receivedQuantity: 30 },
        { sku: 'ESZF8-BK', quantity: 50 },
      ],
    };
    expect(undeliveredItems(partial)).toEqual([
      { sku: 'QIML-CH', quantity: 50 },
      { sku: 'ESZF8-BK', quantity: 50 },
    ]);
  });

  it('returns nothing for drafts, delivered, cancelled and non-SKU transfers', () => {
    for (const status of ['draft', 'delivered', 'cancelled']) {
      expect(undeliveredItems({ ...t0558, status })).toEqual([]);
    }
    expect(undeliveredItems({ ...t0558, isNonSku: true })).toEqual([]);
  });

  it('keeps one entry per pallet line, as they were subtracted', () => {
    const pallets: RestockTransfer = {
      ...t0558,
      items: [
        { sku: 'Q2T16RH', quantity: 250 },
        { sku: 'Q2T16RH', quantity: 50 },
      ],
    };
    expect(undeliveredItems(pallets)).toEqual([
      { sku: 'Q2T16RH', quantity: 250 },
      { sku: 'Q2T16RH', quantity: 50 },
    ]);
  });
});

describe('checkRestockRequest', () => {
  it('accepts the full undelivered quantities of an in-transit transfer', () => {
    expect(checkRestockRequest(t0558, 'China WH', undeliveredItems(t0558))).toBeNull();
  });

  it('accepts pallet lines summed per SKU', () => {
    const pallets: RestockTransfer = {
      ...t0558,
      items: [
        { sku: 'Q2T16RH', quantity: 250 },
        { sku: 'Q2T16RH', quantity: 50 },
      ],
    };
    expect(checkRestockRequest(pallets, 'China WH', [{ sku: 'Q2T16RH', quantity: 300 }])).toBeNull();
  });

  it('refuses a transfer that does not exist', () => {
    expect(checkRestockRequest(undefined, 'China WH', [{ sku: 'QIML-BK', quantity: 1 }])).toMatch(/not found/);
  });

  it('refuses drafts, delivered and already cancelled transfers', () => {
    for (const status of ['draft', 'delivered', 'cancelled']) {
      expect(checkRestockRequest({ ...t0558, status }, 'China WH', [{ sku: 'QIML-BK', quantity: 80 }])).toMatch(status);
    }
  });

  it('refuses non-SKU transfers', () => {
    expect(checkRestockRequest({ ...t0558, isNonSku: true }, 'China WH', [{ sku: 'QIML-BK', quantity: 1 }])).not.toBeNull();
  });

  it('refuses a different origin', () => {
    expect(checkRestockRequest(t0558, 'LA Office', [{ sku: 'QIML-BK', quantity: 80 }])).toMatch(/China WH/);
  });

  it('refuses more than is undelivered, or a SKU not on the transfer', () => {
    expect(checkRestockRequest(t0558, 'China WH', [{ sku: 'QIML-BK', quantity: 81 }])).toMatch(/only 80/);
    expect(checkRestockRequest(t0558, 'China WH', [{ sku: 'EC16', quantity: 1 }])).toMatch(/only 0/);
    const received: RestockTransfer = {
      ...t0558,
      status: 'partial',
      items: [{ sku: 'QIML-BK', quantity: 80, receivedQuantity: 60 }],
    };
    expect(checkRestockRequest(received, 'China WH', [{ sku: 'QIML-BK', quantity: 80 }])).toMatch(/only 20/);
  });
});

// ---- Route: POST /api/transfers/inventory { action: 'restock_cancelled' } ----

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({
  auth: authMock,
  canWrite: (email: string | null | undefined) => email === 'writer@example.com',
}));

const loadCacheMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/inventory-cache', () => ({
  InventoryCacheService: class {
    loadCache = loadCacheMock;
  },
}));

const loadTransfersMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/transfers', () => ({
  TransfersService: { loadTransfers: loadTransfersMock },
}));

import { POST } from '@/app/api/transfers/inventory/route';

function restockReq(body: unknown) {
  return new NextRequest('http://localhost/api/transfers/inventory', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('restock_cancelled route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SHOPIFY_SHOP_DOMAIN = 'test.myshopify.com';
    process.env.SHOPIFY_ACCESS_TOKEN = 'test-token';
    authMock.mockResolvedValue({ user: { name: 'Writer', email: 'writer@example.com' } });
    loadCacheMock.mockResolvedValue({
      inventory: {
        locationIds: { 'China WH': '900' },
        locationDetails: {
          'China WH': [
            { sku: 'QIML-BK', inventoryItemId: '1' },
            { sku: 'QIML-CH', inventoryItemId: '2' },
            { sku: 'ESZF8-BK', inventoryItemId: '3' },
          ],
        },
      },
    });
    loadTransfersMock.mockResolvedValue({ transfers: [t0558], lastUpdated: 'x' });
  });

  it('adds the T0558 quantities back to China WH in Shopify', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: { inventoryAdjustQuantities: { userErrors: [], inventoryAdjustmentGroup: { id: 'g' } } } }),
        { status: 200 },
      ),
    );
    const res = await POST(
      restockReq({ action: 'restock_cancelled', transferId: 'T0558', origin: 'China WH', items: undeliveredItems(t0558) }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(sent.variables.input.reason).toBe('restock');
    expect(sent.variables.input.changes).toEqual([
      { inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/900', delta: 80 },
      { inventoryItemId: 'gid://shopify/InventoryItem/2', locationId: 'gid://shopify/Location/900', delta: 80 },
      { inventoryItemId: 'gid://shopify/InventoryItem/3', locationId: 'gid://shopify/Location/900', delta: 50 },
    ]);
  });

  it('does not touch Shopify when the transfer is already cancelled (repeat click)', async () => {
    loadTransfersMock.mockResolvedValue({ transfers: [{ ...t0558, status: 'cancelled' }], lastUpdated: 'x' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await POST(
      restockReq({ action: 'restock_cancelled', transferId: 'T0558', origin: 'China WH', items: undeliveredItems(t0558) }),
    );
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not touch Shopify when asked for more than the transfer took', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await POST(
      restockReq({ action: 'restock_cancelled', transferId: 'T0558', origin: 'China WH', items: [{ sku: 'QIML-BK', quantity: 500 }] }),
    );
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not touch Shopify when the transfers file cannot be read', async () => {
    loadTransfersMock.mockRejectedValue(new Error('Drive unavailable'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await POST(
      restockReq({ action: 'restock_cancelled', transferId: 'T0558', origin: 'China WH', items: undeliveredItems(t0558) }),
    );
    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
