/**
 * SKU activity log
 *
 * Pure functions for merging Production Order, Transfer, and Inventory Count
 * activity into a unified per-SKU timeline. Used by the SKU Log modal.
 *
 * Each entry corresponds to one Shopify-affecting event for that SKU:
 *   - PO delivery (each `Delivery Logged` activity entry → one row per delivered SKU)
 *   - PO cancellation (one row per SKU with undelivered qty at time of cancel)
 *   - Transfer mark-in-transit (one row per SKU in transfer.items at the time)
 *   - Transfer delivery (each `Delivery Logged` activity entry → one row per delivered SKU)
 *   - Transfer cancellation (one row per SKU with undelivered qty)
 *   - Count submission (one row per SKU appearing in submission.updates)
 *
 * Drafts (`PO Created`, `Transfer Created`) are intentionally skipped because
 * no inventory has actually moved. Same for metadata-only events (notes / ETA
 * updates, generic `Order Updated` / `Transfer Updated`).
 */

import type { ActivityLogEntry, ProductionOrder } from './production-orders';
import type { Transfer, TransferType } from './transfers';

/* ----- Types ----- */

export type SkuLogMovementType = 'po' | 'transfer' | 'count';

export type SkuLogStatus =
  | 'In Transit'
  | 'Partial'
  | 'Delivered'
  | 'Completed'
  | 'Cancelled'
  | null;

export interface InventoryCountSubmission {
  timestamp: string;
  submittedBy: string;
  location?: string;
  updates: Array<{
    sku: string;
    previousOnHand: number;
    newQuantity: number;
  }>;
}

export interface SkuLogEntry {
  /** ISO timestamp the event was recorded. */
  date: string;
  type: SkuLogMovementType;
  /** 'PO-0042' or 'T-0018'; null for counts. */
  refId: string | null;
  /** Human-displayable PO/Transfer label (PO uses poNumber if set, else id). */
  refLabel: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  /** 'Air Express' | 'Air Slow' | 'Sea' | 'Immediate'; null otherwise. */
  shipmentType: TransferType | null;
  /** Movement size for PO/transfer rows. Always positive. null for counts. */
  qty: number | null;
  /** Count-only fields. */
  countPrevious: number | null;
  countCounted: number | null;
  countDelta: number | null;
  status: SkuLogStatus;
  user: string;
  userEmail: string | null;
  /** Stable React key + dedup. */
  eventKey: string;
  /** Free-form note for special cases (e.g. cancellation context). */
  note: string | null;
}

export interface BuildSkuLogParams {
  sku: string;
  productionOrders: readonly ProductionOrder[];
  transfers: readonly Transfer[];
  inventoryLogs: readonly InventoryCountSubmission[];
  /** Inclusive ISO timestamp (lower bound). Entries earlier than this are dropped. */
  periodStart: string;
  /** Inclusive ISO timestamp (upper bound). Entries later than this are dropped. */
  periodEnd: string;
}

/* ----- Parsing helpers ----- */

/**
 * Parse a `Delivery Logged` details block into per-SKU quantities.
 *
 * Matches lines that look like `- SKU → 1,234 (5 MCs)` (the bullet, arrow,
 * commas in the number, and the optional MCs suffix are all tolerated).
 * Both U+2192 RIGHTWARDS ARROW (`→`) and the ASCII `->` are accepted to
 * survive any future formatting tweaks.
 */
export function parseDeliveryDetails(details: string | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (!details) return result;

  const lines = details.split('\n');
  // Tolerate "- SKU → 1,234" or "• SKU -> 1234" with optional MCs suffix.
  const re = /^[\s-•]*(\S+)\s*(?:→|->)\s*([\d,]+)/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    // Skip metadata lines that happen to start with a non-SKU word.
    const sku = m[1];
    if (sku.toLowerCase() === 'status:' || sku.toLowerCase() === 'notes:') continue;
    const qty = parseInt(m[2].replace(/,/g, ''), 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    // If the same SKU appears twice in one block, sum (defensive — shouldn't
    // happen given how the writers work, but safer than overwriting).
    result.set(sku, (result.get(sku) || 0) + qty);
  }
  return result;
}

/** Returns 'Completed' if the action signals the order was fully received. */
function poDeliveryStatus(action: string): SkuLogStatus {
  return action.includes('Order Completed') ? 'Completed' : 'Partial';
}

/** Extract the trailing `Status: <name>` line from a transfer activity entry. */
function transferDeliveryStatus(details: string | undefined): SkuLogStatus {
  if (!details) return 'Partial';
  const m = details.match(/Status:\s*(In Transit|Partial|Delivered|Cancelled)/);
  if (!m) return 'Partial';
  return m[1] as SkuLogStatus;
}

/* ----- Per-source extractors ----- */

function poEntriesForSku(
  order: ProductionOrder,
  skuUpper: string
): SkuLogEntry[] {
  const out: SkuLogEntry[] = [];
  // Skip non-SKU orders entirely — they explicitly bypass inventory.
  if (order.isNonSku) return out;
  if (!order.items.some(i => i.sku.toUpperCase() === skuUpper)) return out;

  const refLabel = order.poNumber || order.id;

  // Walk the activity log. Deliveries become per-SKU rows.
  for (let i = 0; i < (order.activityLog || []).length; i++) {
    const entry = (order.activityLog || [])[i];
    if (!entry.action.startsWith('Delivery Logged')) continue;
    const perSku = parseDeliveryDetails(entry.details);
    const qty = perSku.get(skuUpper) ?? findCaseInsensitive(perSku, skuUpper);
    if (!qty) continue;
    out.push({
      date: entry.timestamp,
      type: 'po',
      refId: order.id,
      refLabel,
      fromLocation: order.vendor || 'Vendor',
      toLocation: null, // Not persisted on PO deliveries today (see review notes).
      shipmentType: null,
      qty,
      countPrevious: null,
      countCounted: null,
      countDelta: null,
      status: poDeliveryStatus(entry.action),
      user: entry.changedBy,
      userEmail: entry.changedByEmail || null,
      eventKey: `po:${order.id}:delivery:${i}:${skuUpper}`,
      note: null,
    });
  }

  // Cancellation: emit one row with the undelivered qty at final state.
  if (order.status === 'cancelled') {
    const item = order.items.find(i => i.sku.toUpperCase() === skuUpper);
    if (item) {
      const undelivered = Math.max(0, item.quantity - (item.receivedQuantity || 0));
      const cancelEntry = findCancellationActivity(order.activityLog);
      const date = order.cancelledAt || cancelEntry?.timestamp || order.updatedAt;
      out.push({
        date,
        type: 'po',
        refId: order.id,
        refLabel,
        fromLocation: order.vendor || 'Vendor',
        toLocation: null,
        shipmentType: null,
        qty: undelivered,
        countPrevious: null,
        countCounted: null,
        countDelta: null,
        status: 'Cancelled',
        user: cancelEntry?.changedBy || order.createdBy,
        userEmail: cancelEntry?.changedByEmail || null,
        eventKey: `po:${order.id}:cancelled:${skuUpper}`,
        note: undelivered > 0 ? 'Undelivered quantity at time of cancel' : 'No pending qty at cancel',
      });
    }
  }

  return out;
}

function transferEntriesForSku(
  transfer: Transfer,
  skuUpper: string
): SkuLogEntry[] {
  const out: SkuLogEntry[] = [];
  if (transfer.isNonSku) return out;

  const item = transfer.items.find(i => i.sku.toUpperCase() === skuUpper);
  if (!item) return out;

  for (let i = 0; i < (transfer.activityLog || []).length; i++) {
    const entry = (transfer.activityLog || [])[i];

    if (entry.action === 'Marked In Transit') {
      // Mark-in-transit moves the full ordered qty out of origin.
      out.push({
        date: entry.timestamp,
        type: 'transfer',
        refId: transfer.id,
        refLabel: transfer.id,
        fromLocation: transfer.origin,
        toLocation: transfer.destination,
        shipmentType: transfer.transferType,
        qty: item.quantity,
        countPrevious: null,
        countCounted: null,
        countDelta: null,
        status: 'In Transit',
        user: entry.changedBy,
        userEmail: entry.changedByEmail || null,
        eventKey: `t:${transfer.id}:in_transit:${i}:${skuUpper}`,
        note: null,
      });
      continue;
    }

    if (entry.action === 'Delivery Logged') {
      const perSku = parseDeliveryDetails(entry.details);
      const qty = perSku.get(skuUpper) ?? findCaseInsensitive(perSku, skuUpper);
      if (!qty) continue;
      out.push({
        date: entry.timestamp,
        type: 'transfer',
        refId: transfer.id,
        refLabel: transfer.id,
        fromLocation: transfer.origin,
        toLocation: transfer.destination,
        shipmentType: transfer.transferType,
        qty,
        countPrevious: null,
        countCounted: null,
        countDelta: null,
        status: transferDeliveryStatus(entry.details),
        user: entry.changedBy,
        userEmail: entry.changedByEmail || null,
        eventKey: `t:${transfer.id}:delivery:${i}:${skuUpper}`,
        note: null,
      });
      continue;
    }

    if (entry.action === 'Transfer Cancelled') {
      const undelivered = Math.max(0, item.quantity - (item.receivedQuantity || 0));
      out.push({
        date: entry.timestamp,
        type: 'transfer',
        refId: transfer.id,
        refLabel: transfer.id,
        fromLocation: transfer.origin,
        toLocation: transfer.destination,
        shipmentType: transfer.transferType,
        qty: undelivered,
        countPrevious: null,
        countCounted: null,
        countDelta: null,
        status: 'Cancelled',
        user: entry.changedBy,
        userEmail: entry.changedByEmail || null,
        eventKey: `t:${transfer.id}:cancelled:${i}:${skuUpper}`,
        note: undelivered > 0 ? 'Undelivered quantity at time of cancel' : null,
      });
      continue;
    }
    // All other actions (Created, Updated, Notes Updated, ETA Updated) skipped.
  }

  return out;
}

function countEntriesForSku(
  submissions: readonly InventoryCountSubmission[],
  skuUpper: string
): SkuLogEntry[] {
  const out: SkuLogEntry[] = [];
  for (let i = 0; i < submissions.length; i++) {
    const sub = submissions[i];
    for (let j = 0; j < sub.updates.length; j++) {
      const u = sub.updates[j];
      if (u.sku.toUpperCase() !== skuUpper) continue;
      out.push({
        date: sub.timestamp,
        type: 'count',
        refId: null,
        refLabel: null,
        fromLocation: null,
        toLocation: sub.location || null,
        shipmentType: null,
        qty: null,
        countPrevious: u.previousOnHand,
        countCounted: u.newQuantity,
        countDelta: u.newQuantity - u.previousOnHand,
        status: null,
        user: sub.submittedBy,
        userEmail: null,
        eventKey: `count:${sub.location || 'unknown'}:${sub.timestamp}:${i}:${j}:${skuUpper}`,
        note: null,
      });
    }
  }
  return out;
}

/* ----- Public API ----- */

/**
 * Build the per-SKU activity log within `[periodStart, periodEnd]`,
 * sorted ascending (oldest first).
 *
 * SKU matching is case-insensitive; the input `sku` is uppercased before
 * comparison since canonical SKUs in this codebase are uppercase.
 */
export function buildSkuLogEntries({
  sku,
  productionOrders,
  transfers,
  inventoryLogs,
  periodStart,
  periodEnd,
}: BuildSkuLogParams): SkuLogEntry[] {
  const skuUpper = sku.trim().toUpperCase();
  if (!skuUpper) return [];

  const startMs = Date.parse(periodStart);
  const endMs = Date.parse(periodEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return [];
  }

  const all: SkuLogEntry[] = [];
  for (const order of productionOrders) all.push(...poEntriesForSku(order, skuUpper));
  for (const transfer of transfers) all.push(...transferEntriesForSku(transfer, skuUpper));
  all.push(...countEntriesForSku(inventoryLogs, skuUpper));

  const filtered = all.filter(e => {
    const t = Date.parse(e.date);
    if (!Number.isFinite(t)) return false;
    return t >= startMs && t <= endMs;
  });

  // Reverse-chronological: newest first.
  filtered.sort((a, b) => {
    const diff = Date.parse(b.date) - Date.parse(a.date);
    if (diff !== 0) return diff;
    // Stable secondary sort by event key for deterministic output.
    return a.eventKey.localeCompare(b.eventKey);
  });

  return filtered;
}

/* ----- Date window helper ----- */

export type SkuLogPeriodPreset = '30d' | '60d' | '90d' | 'custom';

export interface PeriodWindow {
  startIso: string;
  endIso: string;
}

/**
 * Compute the inclusive [start, end] ISO window for a preset period.
 * `now` is injectable for testability.
 */
export function periodWindowForPreset(
  preset: '30d' | '60d' | '90d',
  now: Date = new Date()
): PeriodWindow {
  const days = preset === '30d' ? 30 : preset === '60d' ? 60 : 90;
  // Pure ms arithmetic so DST transitions don't shave an hour off the window.
  const endMs = now.getTime();
  const startMs = endMs - days * 86_400_000;
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

/** Convert a `YYYY-MM-DD` calendar date input pair into an inclusive ISO window
 *  (start = 00:00:00 local, end = 23:59:59.999 local). */
export function periodWindowForCustom(startYmd: string, endYmd: string): PeriodWindow {
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const start = new Date(sy, (sm || 1) - 1, sd || 1, 0, 0, 0, 0);
  const end = new Date(ey, (em || 1) - 1, ed || 1, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/* ----- Internal helpers ----- */

function findCaseInsensitive(map: Map<string, number>, skuUpper: string): number | undefined {
  for (const [k, v] of map) {
    if (k.toUpperCase() === skuUpper) return v;
  }
  return undefined;
}

function findCancellationActivity(
  log: ActivityLogEntry[] | undefined
): ActivityLogEntry | undefined {
  if (!log) return undefined;
  // PO cancellations are recorded as 'Order Updated' with a 'Status: Cancelled'
  // line in details. The most recent such entry wins.
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.details && /Status:\s*Cancelled/i.test(e.details)) return e;
  }
  return undefined;
}
