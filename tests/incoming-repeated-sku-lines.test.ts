/**
 * A transfer can list the same SKU on several lines (one per pallet).
 * Delivering or cancelling it must clear every line from the incoming labels.
 * Reproduces the T0403 / Q2T16RH report: 250 + 50 delivered, 50 label left.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InventoryCacheService,
  consumeTransferEntries,
  removeTransferEntries,
  type IncomingTransferDetail,
} from '@/lib/inventory-cache';

const entry = (transferId: string, quantity: number): IncomingTransferDetail => ({
  transferId,
  quantity,
  note: null,
  createdAt: '2026-09-28T00:00:00.000Z',
  expectedArrivalAt: null,
});

describe('consumeTransferEntries', () => {
  it('clears both lines when the summed delivery covers them', () => {
    const result = consumeTransferEntries([entry('T0403', 250), entry('T0403', 50), entry('T0176', 100)], 'T0403', 300);
    expect(result).toEqual([entry('T0176', 100)]);
  });

  it('leaves the undelivered remainder on a partial delivery', () => {
    const result = consumeTransferEntries([entry('T0403', 250), entry('T0403', 50)], 'T0403', 260);
    expect(result).toEqual([entry('T0403', 40)]);
  });

  it('behaves as before for a single line', () => {
    expect(consumeTransferEntries([entry('T1', 100)], 'T1', 40)).toEqual([entry('T1', 60)]);
    expect(consumeTransferEntries([entry('T1', 100)], 'T1', 100)).toEqual([]);
    expect(consumeTransferEntries([entry('T1', 100)], 'T1', 120)).toEqual([]);
  });

  it('never touches other transfers or the original list', () => {
    const list = [entry('T2', 10), entry('T1', 5)];
    expect(consumeTransferEntries(list, 'T1', 50)).toEqual([entry('T2', 10)]);
    expect(list).toEqual([entry('T2', 10), entry('T1', 5)]);
  });
});

describe('removeTransferEntries', () => {
  it('removes every line of the transfer and totals them', () => {
    const result = removeTransferEntries([entry('T0403', 250), entry('T0176', 100), entry('T0403', 50)], 'T0403');
    expect(result).toEqual({ remaining: [entry('T0176', 100)], removedQuantity: 300 });
  });
});

describe('InventoryCacheService with a two-pallet transfer (local file mode)', () => {
  let tmp: string;
  let service: InventoryCacheService;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-incoming-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    service = new InventoryCacheService();
    fs.writeFileSync(
      path.join(tmp, '.next', 'cache', 'inventory-cache.json'),
      JSON.stringify({ inventory: {}, forecasting: { forecasting: [] }, incomingInventory: {}, lastUpdated: 'x' }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function shipT0176AndT0403() {
    await service.addToIncoming('DTLA WH', 'Sea', [{ sku: 'Q2T16RH', quantity: 100 }], 'T0176', '2026-06-01');
    // Ship-time items are sent per line, so the SKU appears twice.
    await service.addToIncoming(
      'DTLA WH',
      'Sea',
      [
        { sku: 'Q2T16RH', quantity: 250 },
        { sku: 'Q2T16RH', quantity: 50 },
      ],
      'T0403',
      '2026-09-28',
    );
  }

  it('delivering the summed 300 clears both T0403 labels', async () => {
    await shipT0176AndT0403();
    // Deliveries are sent summed per SKU.
    await service.subtractFromIncoming('DTLA WH', 'Sea', [{ sku: 'Q2T16RH', quantity: 300 }], 'T0403');

    const sku = (await service.getIncomingInventory())['DTLA WH'].Q2T16RH;
    expect(sku.inboundSea).toBe(100);
    expect(sku.seaTransfers.map((t) => `${t.transferId}:${t.quantity}`)).toEqual(['T0176:100']);
  });

  it('cancelling the transfer removes both lines and their quantity', async () => {
    await shipT0176AndT0403();
    await service.removeTransferFromIncoming('DTLA WH', 'T0403');

    const sku = (await service.getIncomingInventory())['DTLA WH'].Q2T16RH;
    expect(sku.inboundSea).toBe(100);
    expect(sku.seaTransfers.map((t) => `${t.transferId}:${t.quantity}`)).toEqual(['T0176:100']);
  });
});
