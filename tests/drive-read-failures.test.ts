/**
 * When Google Drive cannot be read, nothing may be saved over the real data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const driveError = new Error('Drive is having a moment');
const drivesListMock = vi.hoisted(() => vi.fn());
const filesUpdateMock = vi.hoisted(() => vi.fn());
const filesCreateMock = vi.hoisted(() => vi.fn());

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {} },
    drive: () => ({
      drives: { list: drivesListMock },
      files: { list: vi.fn(), get: vi.fn(), update: filesUpdateMock, create: filesCreateMock },
    }),
  },
}));

import { TransfersService } from '@/lib/transfers';
import { ProductionOrdersService } from '@/lib/production-orders';
import { InventoryCacheService } from '@/lib/inventory-cache';

beforeEach(() => {
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'svc@example.com';
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----';
  process.env.GOOGLE_PROJECT_ID = 'test-project';
  drivesListMock.mockReset().mockRejectedValue(driveError);
  filesUpdateMock.mockReset();
  filesCreateMock.mockReset();
});

describe('transfers and production orders', () => {
  it('a failed read is reported as an error, not as an empty list', async () => {
    await expect(TransfersService.loadTransfers()).rejects.toThrow(/Could not load transfers/);
    await expect(ProductionOrdersService.loadOrders()).rejects.toThrow(/Could not load production orders/);
  });

  it('creating a record after a failed read saves nothing', async () => {
    await expect(
      TransfersService.createTransfer('LA Office', 'DTLA WH', 'Immediate', [{ sku: 'EC16', quantity: 1 }], 'Tester', 't@example.com'),
    ).rejects.toThrow();
    await expect(
      ProductionOrdersService.createOrder([{ sku: 'EC16', quantity: 1 }], '', 'Tester', 't@example.com'),
    ).rejects.toThrow();
    expect(filesUpdateMock).not.toHaveBeenCalled();
    expect(filesCreateMock).not.toHaveBeenCalled();
  });
});

describe('inventory cache refresh (local file mode)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-cache-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const freshData = {
    inventory: {
      totalSKUs: 1, totalUnits: 5, lowStockCount: 0, outOfStockCount: 0,
      locations: [], locationIds: {}, inventory: [], locationDetails: {},
    },
    forecasting: { forecasting: [] },
  };

  it('refuses to overwrite a cache file it could not read', async () => {
    const service = new InventoryCacheService();
    const cacheFile = path.join(tmp, '.next', 'cache', 'inventory-cache.json');
    fs.writeFileSync(cacheFile, '{ not valid json');

    await expect(service.saveCache(freshData, 'tester')).rejects.toThrow(/not overwritten/);
    expect(fs.readFileSync(cacheFile, 'utf-8')).toBe('{ not valid json');
  });

  it('keeps in-transit inventory on a normal refresh', async () => {
    const service = new InventoryCacheService();
    const cacheFile = path.join(tmp, '.next', 'cache', 'inventory-cache.json');
    const incoming = { 'LA Office': { EC16: { inboundAir: 3, inboundSea: 0, airTransfers: [], seaTransfers: [] } } };
    fs.writeFileSync(cacheFile, JSON.stringify({ ...freshData, incomingInventory: incoming, lastUpdated: 'x' }));

    await service.saveCache(freshData, 'tester');
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')).incomingInventory).toEqual(incoming);
  });

  it('still creates the cache the first time, when no file exists', async () => {
    const service = new InventoryCacheService();
    await service.saveCache(freshData, 'tester');
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, '.next', 'cache', 'inventory-cache.json'), 'utf-8'));
    expect(saved.inventory.totalSKUs).toBe(1);
    expect(saved.incomingInventory).toEqual({});
  });
});
