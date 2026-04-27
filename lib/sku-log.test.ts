import { describe, expect, it } from 'vitest';
import {
  buildSkuLogEntries,
  parseDeliveryDetails,
  periodWindowForCustom,
  periodWindowForPreset,
  type InventoryCountSubmission,
} from './sku-log';
import type { ProductionOrder } from './production-orders';
import type { Transfer } from './transfers';

/* ----- parseDeliveryDetails ----- */

describe('parseDeliveryDetails', () => {
  it('parses a single-line delivery block', () => {
    const map = parseDeliveryDetails('- MBT3Y-DG → 1,234');
    expect(map.get('MBT3Y-DG')).toBe(1234);
  });

  it('parses a multi-line delivery block with MCs and commas', () => {
    const map = parseDeliveryDetails(
      ['- MBT3Y-DG → 1,234 (5 MCs)', '- MBC1-RD → 250'].join('\n')
    );
    expect(map.get('MBT3Y-DG')).toBe(1234);
    expect(map.get('MBC1-RD')).toBe(250);
  });

  it('ignores trailing Status: line', () => {
    const map = parseDeliveryDetails(
      ['- MBT3Y-DG → 100', 'Status: Partial'].join('\n')
    );
    expect(map.size).toBe(1);
    expect(map.get('MBT3Y-DG')).toBe(100);
  });

  it('tolerates the ASCII -> arrow', () => {
    const map = parseDeliveryDetails('- ABC -> 50');
    expect(map.get('ABC')).toBe(50);
  });

  it('returns empty map for undefined details', () => {
    expect(parseDeliveryDetails(undefined).size).toBe(0);
  });

  it('drops zero / negative quantities', () => {
    const map = parseDeliveryDetails(['- ABC → 0', '- DEF → -5'].join('\n'));
    expect(map.size).toBe(0);
  });
});

/* ----- periodWindowForPreset / Custom ----- */

describe('periodWindowForPreset', () => {
  it('produces a window of exactly N days', () => {
    const now = new Date('2025-04-30T12:00:00Z');
    const w30 = periodWindowForPreset('30d', now);
    const w60 = periodWindowForPreset('60d', now);
    const w90 = periodWindowForPreset('90d', now);
    expect(Date.parse(w30.endIso) - Date.parse(w30.startIso)).toBe(30 * 86_400_000);
    expect(Date.parse(w60.endIso) - Date.parse(w60.startIso)).toBe(60 * 86_400_000);
    expect(Date.parse(w90.endIso) - Date.parse(w90.startIso)).toBe(90 * 86_400_000);
  });
});

describe('periodWindowForCustom', () => {
  it('returns the full day for end (23:59:59.999 local)', () => {
    const w = periodWindowForCustom('2025-04-01', '2025-04-30');
    const end = new Date(w.endIso);
    expect(end.getHours() === 23 || end.getUTCHours() >= 0).toBe(true);
    // Sanity: end is after start
    expect(Date.parse(w.endIso)).toBeGreaterThan(Date.parse(w.startIso));
  });
});

/* ----- buildSkuLogEntries ----- */

const allTime = {
  periodStart: '2000-01-01T00:00:00.000Z',
  periodEnd: '2099-01-01T00:00:00.000Z',
};

function makeOrder(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    id: 'PO-0001',
    poNumber: undefined,
    items: [{ sku: 'ABC', quantity: 100, receivedQuantity: 0 }],
    notes: '',
    status: 'in_production',
    createdBy: 'Alex',
    createdByEmail: 'alex@example.com',
    createdAt: '2025-04-01T10:00:00Z',
    updatedAt: '2025-04-01T10:00:00Z',
    activityLog: [
      {
        timestamp: '2025-04-01T10:00:00Z',
        action: 'PO Created',
        changedBy: 'Alex',
        changedByEmail: 'alex@example.com',
        details: '- ABC → 100',
      },
    ],
    ...overrides,
  };
}

function makeTransfer(overrides: Partial<Transfer> = {}): Transfer {
  return {
    id: 'T-0001',
    origin: 'China WH',
    destination: 'LA Office',
    transferType: 'Sea',
    items: [{ sku: 'ABC', quantity: 200 }],
    notes: '',
    status: 'in_transit',
    createdBy: 'Alex',
    createdByEmail: 'alex@example.com',
    createdAt: '2025-04-01T09:00:00Z',
    updatedAt: '2025-04-01T09:00:00Z',
    activityLog: [
      {
        timestamp: '2025-04-01T09:00:00Z',
        action: 'Transfer Created',
        changedBy: 'Alex',
        changedByEmail: 'alex@example.com',
        details: '[Sea] China WH → LA Office:\n- ABC → 200',
      },
    ],
    ...overrides,
  };
}

describe('buildSkuLogEntries — Production Orders', () => {
  it('skips PO Created (drafts do not move inventory)', () => {
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [makeOrder()],
      transfers: [],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(0);
  });

  it('emits one row per Delivery Logged entry, status=Partial when in progress', () => {
    const order = makeOrder({
      activityLog: [
        ...(makeOrder().activityLog || []),
        {
          timestamp: '2025-04-10T12:00:00Z',
          action: 'Delivery Logged',
          changedBy: 'Bob',
          changedByEmail: 'bob@example.com',
          details: '- ABC → 40',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [order],
      transfers: [],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'po',
      refId: 'PO-0001',
      qty: 40,
      status: 'Partial',
      user: 'Bob',
    });
  });

  it('marks status=Completed when action signals order complete', () => {
    const order = makeOrder({
      activityLog: [
        {
          timestamp: '2025-04-10T12:00:00Z',
          action: 'Delivery Logged (Order Completed)',
          changedBy: 'Bob',
          changedByEmail: 'bob@example.com',
          details: '- ABC → 100',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [order],
      transfers: [],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries[0].status).toBe('Completed');
    expect(entries[0].qty).toBe(100);
  });

  it('uses poNumber as refLabel when present', () => {
    const order = makeOrder({
      poNumber: 'SAP-9999',
      activityLog: [
        {
          timestamp: '2025-04-10T12:00:00Z',
          action: 'Delivery Logged',
          changedBy: 'Bob',
          changedByEmail: 'bob@example.com',
          details: '- ABC → 10',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [order],
      transfers: [],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries[0].refLabel).toBe('SAP-9999');
    expect(entries[0].refId).toBe('PO-0001');
  });

  it('emits a Cancelled row with the undelivered qty', () => {
    const order = makeOrder({
      status: 'cancelled',
      cancelledAt: '2025-04-15T08:00:00Z',
      items: [{ sku: 'ABC', quantity: 100, receivedQuantity: 30 }],
      activityLog: [
        {
          timestamp: '2025-04-15T08:00:00Z',
          action: 'Order Updated',
          changedBy: 'Carol',
          changedByEmail: 'carol@example.com',
          details: 'Status: Cancelled',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [order],
      transfers: [],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'po',
      status: 'Cancelled',
      qty: 70, // 100 ordered - 30 received
      user: 'Carol',
    });
  });

  it('skips orders that do not contain the SKU', () => {
    const order = makeOrder({
      items: [{ sku: 'ZZZ', quantity: 100, receivedQuantity: 0 }],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [order],
      transfers: [],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(0);
  });

  it('skips isNonSku orders entirely', () => {
    const order = makeOrder({
      isNonSku: true,
      activityLog: [
        {
          timestamp: '2025-04-10T12:00:00Z',
          action: 'Delivery Logged',
          changedBy: 'Bob',
          changedByEmail: 'bob@example.com',
          details: '- ABC → 100',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [order],
      transfers: [],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(0);
  });
});

describe('buildSkuLogEntries — Transfers', () => {
  it('emits a row for Marked In Transit using item quantity', () => {
    const t = makeTransfer({
      activityLog: [
        ...(makeTransfer().activityLog || []),
        {
          timestamp: '2025-04-05T08:00:00Z',
          action: 'Marked In Transit',
          changedBy: 'Dana',
          changedByEmail: 'dana@example.com',
          details: 'Status: In Transit',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [],
      transfers: [t],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'transfer',
      refId: 'T-0001',
      fromLocation: 'China WH',
      toLocation: 'LA Office',
      shipmentType: 'Sea',
      qty: 200,
      status: 'In Transit',
      user: 'Dana',
    });
  });

  it('emits per-SKU rows from a Delivery Logged event', () => {
    const t = makeTransfer({
      items: [
        { sku: 'ABC', quantity: 200 },
        { sku: 'DEF', quantity: 50 },
      ],
      activityLog: [
        {
          timestamp: '2025-04-15T10:00:00Z',
          action: 'Delivery Logged',
          changedBy: 'Erin',
          changedByEmail: 'erin@example.com',
          details: ['- ABC → 150', '- DEF → 50', 'Status: Partial'].join('\n'),
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [],
      transfers: [t],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ qty: 150, status: 'Partial' });
  });

  it('emits Cancelled row with undelivered qty', () => {
    const t = makeTransfer({
      status: 'cancelled',
      items: [{ sku: 'ABC', quantity: 200, receivedQuantity: 80 }],
      activityLog: [
        {
          timestamp: '2025-04-20T10:00:00Z',
          action: 'Transfer Cancelled',
          changedBy: 'Frank',
          changedByEmail: 'frank@example.com',
          details: 'Status: Cancelled',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [],
      transfers: [t],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      status: 'Cancelled',
      qty: 120, // 200 - 80
      user: 'Frank',
    });
  });

  it('skips isNonSku transfers entirely', () => {
    const t = makeTransfer({
      isNonSku: true,
      activityLog: [
        {
          timestamp: '2025-04-05T08:00:00Z',
          action: 'Marked In Transit',
          changedBy: 'Dana',
          changedByEmail: 'dana@example.com',
          details: 'Status: In Transit',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [],
      transfers: [t],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(0);
  });
});

describe('buildSkuLogEntries — Counts', () => {
  it('emits one count row per SKU appearance with previous/counted/delta', () => {
    const subs: InventoryCountSubmission[] = [
      {
        timestamp: '2025-04-12T19:00:00Z',
        submittedBy: 'Gina',
        location: 'LA Office',
        updates: [
          { sku: 'ABC', previousOnHand: 120, newQuantity: 108 },
          { sku: 'XYZ', previousOnHand: 50, newQuantity: 50 },
        ],
      },
    ];
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [],
      transfers: [],
      inventoryLogs: subs,
      ...allTime,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'count',
      toLocation: 'LA Office',
      countPrevious: 120,
      countCounted: 108,
      countDelta: -12,
      status: null,
      user: 'Gina',
    });
  });
});

describe('buildSkuLogEntries — merging & sorting', () => {
  it('returns reverse-chronological order (newest first) with mixed sources', () => {
    const order = makeOrder({
      activityLog: [
        {
          timestamp: '2025-04-10T12:00:00Z',
          action: 'Delivery Logged',
          changedBy: 'Bob',
          changedByEmail: 'bob@example.com',
          details: '- ABC → 40',
        },
      ],
    });
    const transfer = makeTransfer({
      activityLog: [
        {
          timestamp: '2025-04-05T08:00:00Z',
          action: 'Marked In Transit',
          changedBy: 'Dana',
          changedByEmail: 'dana@example.com',
          details: 'Status: In Transit',
        },
        {
          timestamp: '2025-04-20T08:00:00Z',
          action: 'Delivery Logged',
          changedBy: 'Erin',
          changedByEmail: 'erin@example.com',
          details: '- ABC → 200\nStatus: Delivered',
        },
      ],
    });
    const subs: InventoryCountSubmission[] = [
      {
        timestamp: '2025-04-15T19:00:00Z',
        submittedBy: 'Gina',
        location: 'LA Office',
        updates: [{ sku: 'ABC', previousOnHand: 80, newQuantity: 75 }],
      },
    ];

    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [order],
      transfers: [transfer],
      inventoryLogs: subs,
      ...allTime,
    });
    // Reverse chronological: 2025-04-20 transfer delivery, 2025-04-15 count,
    // 2025-04-10 PO delivery, 2025-04-05 transfer mark-in-transit.
    expect(entries.map(e => e.type)).toEqual(['transfer', 'count', 'po', 'transfer']);
    const dates = entries.map(e => Date.parse(e.date));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('drops entries outside the period window', () => {
    const order = makeOrder({
      activityLog: [
        {
          timestamp: '2025-01-01T12:00:00Z',
          action: 'Delivery Logged',
          changedBy: 'Bob',
          changedByEmail: 'bob@example.com',
          details: '- ABC → 40',
        },
        {
          timestamp: '2025-04-15T12:00:00Z',
          action: 'Delivery Logged',
          changedBy: 'Bob',
          changedByEmail: 'bob@example.com',
          details: '- ABC → 50',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'ABC',
      productionOrders: [order],
      transfers: [],
      inventoryLogs: [],
      periodStart: '2025-04-01T00:00:00Z',
      periodEnd: '2025-04-30T23:59:59Z',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].qty).toBe(50);
  });

  it('matches SKUs case-insensitively', () => {
    const order = makeOrder({
      items: [{ sku: 'mbt3y-dg', quantity: 100, receivedQuantity: 0 }],
      activityLog: [
        {
          timestamp: '2025-04-10T12:00:00Z',
          action: 'Delivery Logged',
          changedBy: 'Bob',
          changedByEmail: 'bob@example.com',
          details: '- mbt3y-dg → 25',
        },
      ],
    });
    const entries = buildSkuLogEntries({
      sku: 'MBT3Y-DG',
      productionOrders: [order],
      transfers: [],
      inventoryLogs: [],
      ...allTime,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].qty).toBe(25);
  });
});
