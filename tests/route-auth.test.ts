/**
 * Route-level access checks: who may call which API route.
 * Shopify, Drive and Slack are never reached in these tests: requests are
 * either rejected before any work, or the cache is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
const roles = vi.hoisted(() => new Map<string, 'write' | 'readonly'>());

vi.mock('@/lib/auth', () => ({
  auth: authMock,
  canWrite: (email: string | null | undefined) => !!email && roles.get(email) === 'write',
}));

const loadCacheMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/inventory-cache', () => ({
  InventoryCacheService: class {
    loadCache = loadCacheMock;
  },
}));

import { GET as inventoryGET } from '@/app/api/inventory/route';
import { GET as forecastingGET } from '@/app/api/forecasting/route';
import { POST as transfersInventoryPOST } from '@/app/api/transfers/inventory/route';
import { POST as phaseOutPOST, DELETE as phaseOutDELETE } from '@/app/api/phase-out/route';
import { POST as mcDataPOST } from '@/app/api/mc-data/route';
import { POST as warehouseLogsPOST } from '@/app/api/warehouse/logs/route';
import { GET as refreshGET } from '@/app/api/refresh/route';

const WRITER = { name: 'Writer', email: 'writer@example.com' };
const READER = { name: 'Reader', email: 'reader@example.com' };

function signInAs(user: { name: string; email: string } | null) {
  authMock.mockResolvedValue(user ? { user } : null);
}

function req(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const cachedData = {
  inventory: { totalSKUs: 1, inventory: [], locationDetails: {}, locations: [], locationIds: {} },
  forecasting: { forecasting: [] },
  lastUpdated: new Date().toISOString(),
  refreshedBy: 'test',
};

beforeEach(() => {
  authMock.mockReset();
  loadCacheMock.mockReset();
  loadCacheMock.mockResolvedValue(cachedData);
  roles.clear();
  roles.set(WRITER.email, 'write');
  roles.set(READER.email, 'readonly');
  delete process.env.AGENT_API_KEY;
});

describe('inventory and forecasting data', () => {
  it('rejects requests without sign-in and does not read the cache', async () => {
    signInAs(null);
    expect((await inventoryGET(req('/api/inventory'))).status).toBe(401);
    expect((await forecastingGET(req('/api/forecasting'))).status).toBe(401);
    expect(loadCacheMock).not.toHaveBeenCalled();
  });

  it('serves read-only and write users exactly as before', async () => {
    for (const user of [READER, WRITER]) {
      signInAs(user);
      const inv = await inventoryGET(req('/api/inventory'));
      expect(inv.status).toBe(200);
      expect((await inv.json()).totalSKUs).toBe(1);
      expect((await forecastingGET(req('/api/forecasting'))).status).toBe(200);
    }
  });

  it('still accepts the agent bearer key', async () => {
    process.env.AGENT_API_KEY = 'agent-key-for-tests-0123456789';
    signInAs(null);
    const res = await inventoryGET(
      req('/api/inventory', { headers: { authorization: 'Bearer agent-key-for-tests-0123456789' } }),
    );
    expect(res.status).toBe(200);
  });
});

describe('actions the dashboard hides from read-only users', () => {
  it('refuses them for read-only users', async () => {
    signInAs(READER);
    const responses = await Promise.all([
      transfersInventoryPOST(req('/api/transfers/inventory', { method: 'POST', body: { action: 'rebuild_incoming' } })),
      phaseOutPOST(req('/api/phase-out', { method: 'POST', body: { sku: 'EC16' } })),
      phaseOutDELETE(req('/api/phase-out?sku=EC16', { method: 'DELETE' })),
      mcDataPOST(req('/api/mc-data', { method: 'POST', body: { EC16: 50 } })),
      warehouseLogsPOST(req('/api/warehouse/logs', { method: 'POST', body: { log: {}, location: 'LA Office' } })),
      refreshGET(req('/api/refresh')),
    ]);
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
  });

  it('refuses them without sign-in', async () => {
    signInAs(null);
    const res = await transfersInventoryPOST(
      req('/api/transfers/inventory', { method: 'POST', body: { action: 'rebuild_incoming' } }),
    );
    expect(res.status).toBe(401);
  });
});

describe('input checks on write routes', () => {
  beforeEach(() => {
    signInAs(WRITER);
    process.env.SHOPIFY_SHOP_DOMAIN = 'example.myshopify.com';
    process.env.SHOPIFY_ACCESS_TOKEN = 'test-token';
  });

  it('rejects a negative transfer quantity before touching Shopify', async () => {
    // A cache that knows the location and SKU, so only the quantity check can stop it.
    loadCacheMock.mockResolvedValue({
      ...cachedData,
      inventory: {
        ...cachedData.inventory,
        locationIds: { 'LA Office': '111' },
        locationDetails: { 'LA Office': [{ sku: 'EC16', inventoryItemId: '222', onHand: 10 }] },
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    const res = await transfersInventoryPOST(
      req('/api/transfers/inventory', {
        method: 'POST',
        body: { action: 'restock_cancelled', transferId: 'T0001', origin: 'LA Office', items: [{ sku: 'EC16', quantity: -4 }] },
      }),
    );
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects MC data that is not a SKU map', async () => {
    const res = await mcDataPOST(req('/api/mc-data', { method: 'POST', body: ['not', 'a', 'map'] }));
    expect(res.status).toBe(400);
  });
});
