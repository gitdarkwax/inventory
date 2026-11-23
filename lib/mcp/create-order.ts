/**
 * Checks for the one connector tool that writes: creating a production order.
 *
 * The order itself is created by ProductionOrdersService.createOrder, exactly
 * as the web form does. This file only decides whether a request may go ahead.
 */

import type { ProductionOrder } from '@/lib/production-orders';
import type { ConnectorUser } from './auth';

export interface CreateOrderInput {
  vendor: string;
  items: { sku: string; quantity: number }[];
  eta?: string;
  notes?: string;
  confirmed: boolean;
}

export type CreateOrderPlan =
  | { ok: true; vendor: string; items: { sku: string; quantity: number }[]; eta?: string; notes: string }
  | { ok: false; message: string };

/** Emails allowed to create production orders through Claude (CONNECTOR_PO_CREATORS, comma-separated). */
export function poCreators(raw: string | undefined = process.env.CONNECTOR_PO_CREATORS): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function sameItems(a: { sku: string; quantity: number }[], b: { sku: string; quantity: number }[]) {
  const key = (rows: { sku: string; quantity: number }[]) =>
    rows
      .map((r) => `${r.sku.toUpperCase()}=${r.quantity}`)
      .sort()
      .join('|');
  return key(a) === key(b);
}

export function planCreateOrder(
  input: CreateOrderInput,
  deps: {
    user: ConnectorUser;
    creators: Set<string>;
    /** SKU as written in the app, keyed by lower-case SKU. */
    knownSkus: Map<string, string>;
    orders: ProductionOrder[];
    now?: number;
  },
): CreateOrderPlan {
  const { user, creators, knownSkus, orders } = deps;
  const email = (user.email ?? '').toLowerCase();
  if (user.role !== 'write' || !email || !creators.has(email)) {
    return {
      ok: false,
      message:
        `${user.email ?? 'This account'} may not create production orders through Claude. ` +
        'Create the order in the inventory app, or ask an admin to add this email to the list of people who can.',
    };
  }

  const vendor = input.vendor.trim();
  if (!vendor) return { ok: false, message: 'A vendor is required.' };
  if (input.items.length === 0) return { ok: false, message: 'At least one SKU and quantity is required.' };

  const items: { sku: string; quantity: number }[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const item of input.items) {
    const known = knownSkus.get(item.sku.trim().toLowerCase());
    if (!known) {
      unknown.push(item.sku);
      continue;
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, message: `The quantity for ${known} must be a whole number above zero.` };
    }
    if (seen.has(known)) return { ok: false, message: `${known} is listed twice. Give one quantity per SKU.` };
    seen.add(known);
    items.push({ sku: known, quantity: item.quantity });
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Not a SKU in the inventory app: ${unknown.join(', ')}. Use find_skus to get the exact SKU.`,
    };
  }

  if (input.eta !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.eta)) {
    return { ok: false, message: 'The ETA must be a date written as YYYY-MM-DD.' };
  }

  const now = deps.now ?? Date.now();
  const twin = orders.find(
    (o) =>
      o.status !== 'cancelled' &&
      now - new Date(o.createdAt).getTime() < DUPLICATE_WINDOW_MS &&
      (o.vendor ?? '').trim().toLowerCase() === vendor.toLowerCase() &&
      sameItems(o.items, items),
  );
  if (twin) {
    return {
      ok: false,
      message: `${twin.id} was created a few minutes ago with the same vendor, SKUs and quantities. Nothing new was created.`,
    };
  }

  if (!input.confirmed) {
    return {
      ok: false,
      message:
        'Not created. Show the person the vendor, each SKU and quantity and the ETA, and call again with confirmed: true only after they say yes.',
    };
  }

  return { ok: true, vendor, items, eta: input.eta, notes: (input.notes ?? '').trim() };
}
