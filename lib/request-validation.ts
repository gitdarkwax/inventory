/**
 * Input checks for routes that change Shopify stock.
 *
 * These only reject values the dashboard never sends (negative or fractional
 * unit counts, blank SKUs, non-numbers), so normal use is unaffected.
 * Whole-number strings such as "12" are accepted and turned into numbers,
 * because older saved records may hold quantities as strings.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse a whole number (number or whole-number string). Returns null if invalid. */
export function parseWholeNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Items moved by a transfer (ship, receive, restock): each needs a SKU and a
 * unit count of zero or more. A negative count would reverse the stock move.
 */
export function validateMovedItems(
  items: unknown,
): ValidationResult<Array<{ sku: string; quantity: number }>> {
  if (!Array.isArray(items)) {
    return { ok: false, error: 'items must be a list' };
  }
  const result: Array<{ sku: string; quantity: number }> = [];
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `Item ${index + 1} is not valid` };
    }
    const { sku, quantity } = item as { sku?: unknown; quantity?: unknown };
    if (!isNonBlankString(sku)) {
      return { ok: false, error: `Item ${index + 1} is missing a SKU` };
    }
    const parsed = parseWholeNumber(quantity);
    if (parsed === null || parsed < 0) {
      return { ok: false, error: `Quantity for ${sku.trim()} must be a whole number of 0 or more` };
    }
    result.push({ ...(item as object), sku, quantity: parsed });
  }
  return { ok: true, value: result };
}

/**
 * Absolute stock levels sent to /api/inventory/update. Negative totals are
 * allowed because Shopify on-hand can already be negative (oversold), and a
 * PO delivery adds to that number.
 */
export function validateInventoryUpdates<T extends object>(
  updates: unknown,
): ValidationResult<Array<T & { sku: string; quantity: number }>> {
  if (!Array.isArray(updates) || updates.length === 0) {
    return { ok: false, error: 'No updates provided' };
  }
  const result: Array<T & { sku: string; quantity: number }> = [];
  for (const [index, update] of updates.entries()) {
    if (!update || typeof update !== 'object') {
      return { ok: false, error: `Update ${index + 1} is not valid` };
    }
    const { sku, quantity, inventoryItemId, locationId } = update as Record<string, unknown>;
    if (!isNonBlankString(sku)) {
      return { ok: false, error: `Update ${index + 1} is missing a SKU` };
    }
    if (inventoryItemId === undefined || inventoryItemId === null || inventoryItemId === '') {
      return { ok: false, error: `Update for ${sku.trim()} is missing inventoryItemId` };
    }
    if (locationId === undefined || locationId === null || locationId === '') {
      return { ok: false, error: `Update for ${sku.trim()} is missing locationId` };
    }
    const parsed = parseWholeNumber(quantity);
    if (parsed === null) {
      return { ok: false, error: `Quantity for ${sku.trim()} must be a whole number` };
    }
    result.push({ ...(update as T), sku, quantity: parsed });
  }
  return { ok: true, value: result };
}
