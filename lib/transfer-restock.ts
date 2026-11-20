/**
 * Restocking the origin when a transfer is cancelled.
 *
 * Marking a transfer in transit subtracts its full quantities from the origin's
 * On Hand in Shopify. If it is cancelled before everything arrives, whatever was
 * not received has to go back to the origin, whether nothing has arrived yet
 * (in transit) or only some of it has (partial).
 *
 * Kept free of server-only imports so the dashboard can use it too.
 */

export interface RestockTransferItem {
  sku: string;
  quantity: number;
  receivedQuantity?: number;
}

export interface RestockTransfer {
  id: string;
  origin: string;
  status: string;
  isNonSku?: boolean;
  items: RestockTransferItem[];
}

/** Statuses in which the origin has been subtracted but not everything has arrived. */
export const RESTOCKABLE_STATUSES = ['in_transit', 'partial'] as const;

export function isRestockableStatus(status: string): boolean {
  return (RESTOCKABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Quantities still owed back to the origin if this transfer is cancelled now.
 * One entry per line, so a SKU on several lines (pallets) appears several times,
 * exactly as it was subtracted.
 */
export function undeliveredItems(transfer: RestockTransfer): Array<{ sku: string; quantity: number }> {
  if (transfer.isNonSku || !isRestockableStatus(transfer.status)) return [];
  return transfer.items
    .map(item => ({
      sku: item.sku,
      quantity: item.quantity - (item.receivedQuantity || 0),
    }))
    .filter(item => item.quantity > 0);
}

function totalsBySku(items: Array<{ sku: string; quantity: number }>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const key = item.sku.trim().toUpperCase();
    totals.set(key, (totals.get(key) || 0) + item.quantity);
  }
  return totals;
}

/**
 * Server-side check before adding stock back to the origin.
 * Returns an error message, or null when the restock matches the stored transfer.
 */
export function checkRestockRequest(
  transfer: RestockTransfer | undefined,
  origin: string,
  items: Array<{ sku: string; quantity: number }>
): string | null {
  if (!transfer) return 'Transfer not found';
  if (transfer.isNonSku) return `Transfer ${transfer.id} has no stock to restock`;
  if (!isRestockableStatus(transfer.status)) {
    return `Transfer ${transfer.id} is ${transfer.status}; only in-transit or partly delivered transfers can be restocked`;
  }
  if (transfer.origin !== origin) {
    return `Transfer ${transfer.id} came from ${transfer.origin}, not ${origin}`;
  }

  const owed = totalsBySku(undeliveredItems(transfer));
  for (const [sku, requested] of totalsBySku(items)) {
    const allowed = owed.get(sku) || 0;
    if (requested > allowed) {
      return `Cannot restock ${requested} of ${sku} for ${transfer.id}; only ${allowed} undelivered`;
    }
  }
  return null;
}
