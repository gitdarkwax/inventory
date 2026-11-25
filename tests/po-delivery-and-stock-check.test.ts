/**
 * 2026-11-24/25, ECFLD-BK at China WH:
 * - PO-0116 (500) and PO-0132 (2500) were logged 55 s apart from one page. Each wrote
 *   "page count + delivery" as an absolute total, so the second overwrote the first
 *   and 500 units vanished. Deliveries now send only the delivered amount ('add' mode).
 * - Eleven transfers were then marked in transit from the same stale page; the browser
 *   check let T0591 (350) through with 200 left, and China went to -150. The server now
 *   checks live Shopify On Hand before subtracting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { findShortfalls } from '@/lib/live-stock';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({
  auth: authMock,
  canWrite: (email: string | null | undefined) => email === 'writer@example.com',
}));

const loadCacheMock = vi.hoisted(() => vi.fn());
const addToIncomingMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/inventory-cache', () => ({
  InventoryCacheService: class {
    loadCache = loadCacheMock;
    addToIncoming = addToIncomingMock;
  },
}));

vi.mock('@/lib/transfers', () => ({
  TransfersService: { loadTransfers: vi.fn() },
}));

import { POST as updatePOST } from '@/app/api/inventory/update/route';
import { POST as transfersInventoryPOST } from '@/app/api/transfers/inventory/route';

const CHINA = '115937935441';
const ECFLD = '64612111941713';
const OTHER = '555';

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type ShopifyCall = { query: string; variables: Record<string, unknown> };

/** Fake Shopify: answers the live On Hand query from `onHand`, accepts every write. */
function fakeShopify(onHand: Record<string, number>, opts: { failReads?: boolean } = {}) {
  const calls: ShopifyCall[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as ShopifyCall;
    calls.push(body);
    if (body.query.includes('liveOnHand')) {
      if (opts.failReads) return new Response('boom', { status: 503 });
      const ids = body.variables.ids as string[];
      return new Response(
        JSON.stringify({
          data: {
            nodes: ids.map(id => {
              const bare = id.replace('gid://shopify/InventoryItem/', '');
              return bare in onHand
                ? { id, inventoryLevel: { quantities: [{ name: 'on_hand', quantity: onHand[bare] }] } }
                : { id, inventoryLevel: null };
            }),
          },
        }),
        { status: 200 },
      );
    }
    const op = body.query.includes('inventoryAdjustQuantities') ? 'inventoryAdjustQuantities' : 'inventorySetQuantities';
    return new Response(
      JSON.stringify({ data: { [op]: { userErrors: [], inventoryAdjustmentGroup: { id: 'g', changes: [] } } } }),
      { status: 200 },
    );
  });
  return { calls, spy, writes: () => calls.filter(c => !c.query.includes('liveOnHand')) };
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.SHOPIFY_SHOP_DOMAIN = 'test.myshopify.com';
  process.env.SHOPIFY_ACCESS_TOKEN = 'test-token';
  authMock.mockResolvedValue({ user: { name: 'Writer', email: 'writer@example.com' } });
  addToIncomingMock.mockReset();
  addToIncomingMock.mockResolvedValue(undefined);
  loadCacheMock.mockResolvedValue({
    inventory: {
      locationIds: { 'China WH': CHINA, 'LA Office': '62582620241' },
      locationDetails: {
        'China WH': [
          { sku: 'ECFLD-BK', inventoryItemId: ECFLD, onHand: 0 },
          { sku: 'EC16', inventoryItemId: OTHER, onHand: 0 },
        ],
        'LA Office': [{ sku: 'ECFLD-BK', inventoryItemId: ECFLD, onHand: 6 }],
      },
    },
  });
});

const delivery = (quantity: number, sku = 'ECFLD-BK', inventoryItemId = ECFLD) => ({
  sku,
  inventoryItemId,
  locationId: CHINA,
  quantity,
});

describe("PO delivery: /api/inventory/update in 'add' mode", () => {
  it('PO-0116 then PO-0132 from the same page each add their own amount', async () => {
    const shopify = fakeShopify({});
    const first = await updatePOST(post('/api/inventory/update', { mode: 'add', updates: [delivery(500)] }));
    const second = await updatePOST(post('/api/inventory/update', { mode: 'add', updates: [delivery(2500)] }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const writes = shopify.writes();
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      expect(w.query).toContain('inventoryAdjustQuantities');
      expect(w.query).not.toContain('inventorySetQuantities');
    }
    const deltas = writes.map(w => (w.variables.input as { changes: Array<{ delta: number }> }).changes[0].delta);
    expect(deltas).toEqual([500, 2500]); // 3000 in total, whatever the page showed
    const input = writes[0].variables.input as Record<string, unknown>;
    expect(input).toMatchObject({ name: 'available', reason: 'received' });
    expect(input).not.toHaveProperty('ignoreCompareQuantity');
  });

  it('adds two lines of the same SKU together', async () => {
    const shopify = fakeShopify({});
    const res = await updatePOST(
      post('/api/inventory/update', { mode: 'add', updates: [delivery(250), delivery(50), delivery(10, 'EC16', OTHER)] }),
    );
    expect(res.status).toBe(200);
    const changes = (shopify.writes()[0].variables.input as { changes: Array<{ inventoryItemId: string; delta: number }> }).changes;
    expect(changes).toEqual([
      { inventoryItemId: `gid://shopify/InventoryItem/${ECFLD}`, locationId: `gid://shopify/Location/${CHINA}`, delta: 300 },
      { inventoryItemId: `gid://shopify/InventoryItem/${OTHER}`, locationId: `gid://shopify/Location/${CHINA}`, delta: 10 },
    ]);
    const body = await res.json();
    expect(body.summary).toMatchObject({ success: 2, failed: 0 });
  });

  it('refuses a negative amount and touches nothing', async () => {
    const shopify = fakeShopify({});
    const res = await updatePOST(post('/api/inventory/update', { mode: 'add', updates: [delivery(-5)] }));
    expect(res.status).toBe(400);
    expect(shopify.calls).toHaveLength(0);
  });

  it('refuses an unknown mode', async () => {
    const shopify = fakeShopify({});
    const res = await updatePOST(post('/api/inventory/update', { mode: 'plus', updates: [delivery(5)] }));
    expect(res.status).toBe(400);
    expect(shopify.calls).toHaveLength(0);
  });

  it('physical counts (no mode) still set absolute totals, unchanged', async () => {
    const shopify = fakeShopify({});
    const res = await updatePOST(post('/api/inventory/update', { updates: [delivery(1234)] }));
    expect(res.status).toBe(200);
    const w = shopify.writes()[0];
    expect(w.query).toContain('inventorySetQuantities');
    expect(w.variables.input).toMatchObject({
      name: 'on_hand',
      reason: 'correction',
      ignoreCompareQuantity: true,
      quantities: [{ inventoryItemId: `gid://shopify/InventoryItem/${ECFLD}`, locationId: `gid://shopify/Location/${CHINA}`, quantity: 1234 }],
    });
  });
});

describe('findShortfalls', () => {
  it('sums pallet lines per SKU and treats an unstocked item as 0', () => {
    const onHand = new Map([[ECFLD, 299]]);
    expect(
      findShortfalls(
        [
          { sku: 'ECFLD-BK', quantity: 250, inventoryItemId: ECFLD },
          { sku: 'ECFLD-BK', quantity: 50, inventoryItemId: ECFLD },
          { sku: 'EC16', quantity: 1, inventoryItemId: OTHER },
        ],
        onHand,
      ),
    ).toEqual([
      { sku: 'ECFLD-BK', requested: 300, onHand: 299 },
      { sku: 'EC16', requested: 1, onHand: 0 },
    ]);
  });

  it('passes when there is exactly enough', () => {
    expect(findShortfalls([{ sku: 'ECFLD-BK', quantity: 350, inventoryItemId: ECFLD }], new Map([[ECFLD, 350]]))).toEqual([]);
  });
});

describe('mark_in_transit checks live Shopify stock first', () => {
  const t0591 = {
    action: 'mark_in_transit',
    transferId: 'T0591',
    origin: 'China WH',
    destination: 'LA Office',
    shipmentType: 'Air Express',
    items: [{ sku: 'ECFLD-BK', quantity: 350 }],
  };

  it('refuses T0591 when only 200 are really left, even though the page showed more', async () => {
    const shopify = fakeShopify({ [ECFLD]: 200 });
    const res = await transfersInventoryPOST(post('/api/transfers/inventory', t0591));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.details).toBe('ECFLD-BK: need 350, only 200 at China WH');
    expect(shopify.writes()).toHaveLength(0);
    expect(addToIncomingMock).not.toHaveBeenCalled();
  });

  it('goes ahead when there is enough, subtracting the origin as before', async () => {
    const shopify = fakeShopify({ [ECFLD]: 350 });
    const res = await transfersInventoryPOST(post('/api/transfers/inventory', t0591));
    expect(res.status).toBe(200);
    const writes = shopify.writes();
    expect(writes).toHaveLength(1);
    expect((writes[0].variables.input as { changes: unknown[] }).changes).toEqual([
      { inventoryItemId: `gid://shopify/InventoryItem/${ECFLD}`, locationId: `gid://shopify/Location/${CHINA}`, delta: -350 },
    ]);
    expect(addToIncomingMock).toHaveBeenCalledTimes(1);
  });

  it('changes nothing if Shopify stock cannot be read', async () => {
    const shopify = fakeShopify({ [ECFLD]: 9999 }, { failReads: true });
    const res = await transfersInventoryPOST(post('/api/transfers/inventory', t0591));
    expect(res.status).toBe(502);
    expect(shopify.writes()).toHaveLength(0);
  });
});
