/**
 * Read-only queries behind the Claude connector's tools.
 *
 * Everything here is a pure function over data the app already stores (the
 * hourly inventory cache, transfers, production orders, SKU notes), so the
 * answers match what the dashboard shows and nothing is written anywhere.
 */

import type {
  CachedInventoryData,
  IncomingInventoryCache,
  LocationDetail,
} from '@/lib/inventory-cache';
import type { Transfer, TransferStatus } from '@/lib/transfers';
import type { ProductionOrder } from '@/lib/production-orders';
import { getDisplayPaymentPercentPaid } from '@/lib/production-order-payment';

/** Burn rate used for runway, matching the app's low-stock alerts. */
export const RUNWAY_BASIS = 'avgDaily21d' as const;

export type SkuFlags = {
  hidden: Set<string>;
  phaseOut: Set<string>;
};

const lower = (s: string) => s.toLowerCase();

export function cacheFreshness(cache: CachedInventoryData, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(cache.lastUpdated).getTime()) / 60000));
  return {
    lastRefreshed: cache.lastUpdated,
    minutesAgo: minutes,
    refreshedBy: cache.refreshedBy ?? null,
    note: 'Stock comes from the app’s hourly Shopify snapshot, not live Shopify.',
  };
}

export function searchSkus(
  cache: CachedInventoryData,
  query: string,
  flags: SkuFlags,
  limit = 25,
) {
  const terms = lower(query).split(/\s+/).filter(Boolean);
  const rows = cache.inventory.inventory.filter((item) => {
    const haystack = lower(`${item.sku} ${item.productTitle} ${item.variantTitle}`);
    return terms.every((t) => haystack.includes(t));
  });
  // Exact SKU match first, then SKU prefix, then the rest.
  const q = lower(query.trim());
  rows.sort((a, b) => rank(a.sku) - rank(b.sku) || a.sku.localeCompare(b.sku));
  function rank(sku: string) {
    const s = lower(sku);
    if (s === q) return 0;
    if (s.startsWith(q)) return 1;
    return 2;
  }
  return {
    totalMatches: rows.length,
    results: rows.slice(0, limit).map((item) => ({
      sku: item.sku,
      product: item.productTitle,
      variant: item.variantTitle,
      totalAvailable: item.totalAvailable,
      hidden: flags.hidden.has(lower(item.sku)),
      phaseOut: flags.phaseOut.has(lower(item.sku)),
    })),
  };
}

function findLocationDetail(details: LocationDetail[] | undefined, sku: string) {
  const s = lower(sku);
  return details?.find((d) => lower(d.sku) === s);
}

function incomingFor(incoming: IncomingInventoryCache, location: string, sku: string) {
  const bySku = incoming[location] ?? {};
  const key = Object.keys(bySku).find((k) => lower(k) === lower(sku));
  const entry = key ? bySku[key] : undefined;
  return {
    inboundAir: entry?.inboundAir ?? 0,
    inboundSea: entry?.inboundSea ?? 0,
    shipments: [...(entry?.airTransfers ?? []), ...(entry?.seaTransfers ?? [])].map((t) => ({
      transfer: t.transferId,
      quantity: t.quantity,
      expectedArrival: t.expectedArrivalAt,
    })),
  };
}

function runwayDays(available: number, perDay: number | undefined): number | null {
  if (!perDay || perDay <= 0) return null;
  return Math.round((available / perDay) * 10) / 10;
}

export function skuStock(
  cache: CachedInventoryData,
  sku: string,
  pendingPoQuantity: number,
  flags: SkuFlags,
) {
  const s = lower(sku);
  const item = cache.inventory.inventory.find((i) => lower(i.sku) === s);
  if (!item) return null;
  const forecast = cache.forecasting.forecasting.find((f) => lower(f.sku) === s);
  const incoming = cache.incomingInventory ?? {};

  const locations = cache.inventory.locations.map((location) => {
    const detail = findLocationDetail(cache.inventory.locationDetails[location], item.sku);
    return {
      location,
      available: detail?.available ?? item.locations[location] ?? 0,
      onHand: detail?.onHand ?? null,
      committed: detail?.committed ?? null,
      incoming: incomingFor(incoming, location, item.sku),
    };
  });

  return {
    sku: item.sku,
    product: item.productTitle,
    variant: item.variantTitle,
    hidden: flags.hidden.has(s),
    phaseOut: flags.phaseOut.has(s),
    totalAvailable: item.totalAvailable,
    pendingFromProductionOrders: pendingPoQuantity,
    locations,
    salesPerDay: forecast
      ? {
          last7Days: forecast.avgDaily7d,
          last21Days: forecast.avgDaily21d,
          last90Days: forecast.avgDaily90d,
          sameMonthLastYear: forecast.avgDailyLastYear30d,
        }
      : null,
    runwayDaysAllLocations: runwayDays(item.totalAvailable, forecast?.[RUNWAY_BASIS]),
    runwayBasis: '21-day average daily sales (same as the app’s low-stock alerts)',
    freshness: cacheFreshness(cache),
  };
}

export function lowStock(
  cache: CachedInventoryData,
  options: {
    location?: string;
    maxDays: number;
    includeHidden?: boolean;
    includePhaseOut?: boolean;
    limit?: number;
  },
  flags: SkuFlags,
) {
  const forecasts = new Map(cache.forecasting.forecasting.map((f) => [lower(f.sku), f]));
  const location = options.location
    ? cache.inventory.locations.find((l) => lower(l) === lower(options.location!))
    : undefined;
  if (options.location && !location) {
    return { error: `Unknown location "${options.location}".`, locations: cache.inventory.locations };
  }
  const incoming = cache.incomingInventory ?? {};

  const rows = cache.inventory.inventory
    .filter((item) => options.includeHidden || !flags.hidden.has(lower(item.sku)))
    .filter((item) => options.includePhaseOut || !flags.phaseOut.has(lower(item.sku)))
    .map((item) => {
      const perDay = forecasts.get(lower(item.sku))?.[RUNWAY_BASIS] ?? 0;
      const available = location ? item.locations[location] ?? 0 : item.totalAvailable;
      const inbound = location
        ? (() => {
            const i = incomingFor(incoming, location, item.sku);
            return i.inboundAir + i.inboundSea;
          })()
        : null;
      return {
        sku: item.sku,
        product: item.productTitle,
        variant: item.variantTitle,
        available,
        incomingToLocation: inbound,
        salesPerDay21d: perDay,
        runwayDays: runwayDays(available, perDay),
        phaseOut: flags.phaseOut.has(lower(item.sku)),
      };
    })
    .filter((r) => r.runwayDays !== null && r.runwayDays < options.maxDays)
    .sort((a, b) => (a.runwayDays ?? 0) - (b.runwayDays ?? 0));

  return {
    scope: location ?? 'all locations combined',
    maxDays: options.maxDays,
    runwayBasis: '21-day average daily sales (same as the app’s low-stock alerts)',
    count: rows.length,
    results: rows.slice(0, options.limit ?? 50),
    excluded: {
      hidden: !options.includeHidden,
      phaseOut: !options.includePhaseOut,
      noRecentSales: 'SKUs with no sales in the last 21 days have no runway and are not listed',
    },
    freshness: cacheFreshness(cache),
  };
}

export function incomingSummary(
  cache: CachedInventoryData,
  options: { destination?: string; sku?: string },
) {
  const incoming = cache.incomingInventory ?? {};
  const out: Array<{
    destination: string;
    sku: string;
    inboundAir: number;
    inboundSea: number;
    shipments: Array<{ transfer: string; quantity: number; expectedArrival: string | null }>;
  }> = [];
  for (const [destination, bySku] of Object.entries(incoming)) {
    if (options.destination && lower(destination) !== lower(options.destination)) continue;
    for (const [sku, entry] of Object.entries(bySku)) {
      if (options.sku && lower(sku) !== lower(options.sku)) continue;
      if ((entry.inboundAir ?? 0) + (entry.inboundSea ?? 0) <= 0) continue;
      out.push({
        destination,
        sku,
        inboundAir: entry.inboundAir ?? 0,
        inboundSea: entry.inboundSea ?? 0,
        shipments: [...(entry.airTransfers ?? []), ...(entry.seaTransfers ?? [])].map((t) => ({
          transfer: t.transferId,
          quantity: t.quantity,
          expectedArrival: t.expectedArrivalAt,
        })),
      });
    }
  }
  out.sort((a, b) => a.destination.localeCompare(b.destination) || a.sku.localeCompare(b.sku));
  return { count: out.length, results: out, destinations: Object.keys(incoming) };
}

function transferSummary(t: Transfer) {
  return {
    id: t.id,
    status: t.status,
    type: t.transferType,
    origin: t.origin,
    destination: t.destination,
    units: t.items.reduce((sum, i) => sum + (i.quantity || 0), 0),
    skus: t.items.length,
    carrier: t.carrier || null,
    trackingNumber: t.trackingNumber || null,
    eta: t.eta || null,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    deliveredAt: t.deliveredAt ?? null,
  };
}

export function listTransfers(
  transfers: Transfer[],
  options: { status?: TransferStatus; sku?: string; destination?: string; limit?: number },
) {
  const rows = transfers
    .filter((t) => !options.status || t.status === options.status)
    .filter((t) => !options.destination || lower(t.destination) === lower(options.destination))
    .filter((t) => !options.sku || t.items.some((i) => lower(i.sku) === lower(options.sku!)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { count: rows.length, results: rows.slice(0, options.limit ?? 25).map(transferSummary) };
}

export function getTransfer(transfers: Transfer[], id: string) {
  const t = transfers.find((x) => lower(x.id) === lower(id.trim()));
  if (!t) return null;
  return {
    ...transferSummary(t),
    notes: t.notes || null,
    items: t.items.map((i) => ({
      sku: i.sku,
      quantity: i.quantity,
      received: i.receivedQuantity ?? null,
      pallet: i.pallet ?? null,
      masterCartons: i.masterCartons ?? null,
    })),
    cancelledAt: t.cancelledAt ?? null,
    recentActivity: (t.activityLog ?? []).slice(-10),
  };
}

function orderSummary(o: ProductionOrder) {
  const ordered = o.items.reduce((s, i) => s + (i.quantity || 0), 0);
  const received = o.items.reduce((s, i) => s + (i.receivedQuantity || 0), 0);
  return {
    id: o.id,
    poNumber: o.poNumber ?? null,
    status: o.status,
    vendor: o.vendor ?? null,
    eta: o.eta ?? null,
    unitsOrdered: ordered,
    unitsReceived: received,
    skus: o.items.length,
    paymentPercentPaid: getDisplayPaymentPercentPaid(o.status, o.paymentPercentPaid, o.paymentStatus),
    createdBy: o.createdBy,
    createdAt: o.createdAt,
    completedAt: o.completedAt ?? null,
  };
}

export function listProductionOrders(
  orders: ProductionOrder[],
  options: { status?: ProductionOrder['status']; sku?: string; vendor?: string; limit?: number },
) {
  const rows = orders
    .filter((o) => !options.status || o.status === options.status)
    .filter((o) => !options.vendor || lower(o.vendor ?? '').includes(lower(options.vendor!)))
    .filter((o) => !options.sku || o.items.some((i) => lower(i.sku) === lower(options.sku!)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { count: rows.length, results: rows.slice(0, options.limit ?? 25).map(orderSummary) };
}

export function getProductionOrder(orders: ProductionOrder[], idOrPoNumber: string) {
  const key = lower(idOrPoNumber.trim());
  const o = orders.find((x) => lower(x.id) === key || lower(x.poNumber ?? '') === key);
  if (!o) return null;
  return {
    ...orderSummary(o),
    notes: o.notes || null,
    items: o.items.map((i) => ({
      sku: i.sku,
      ordered: i.quantity,
      received: i.receivedQuantity || 0,
      pending: Math.max(0, i.quantity - (i.receivedQuantity || 0)),
      masterCartons: i.masterCartons ?? null,
    })),
    cancelledAt: o.cancelledAt ?? null,
    recentActivity: (o.activityLog ?? []).slice(-10),
  };
}
