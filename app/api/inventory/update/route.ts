/**
 * Inventory Update API Route
 * Updates inventory quantities in Shopify using GraphQL Admin API
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth, canWrite } from '@/lib/auth';
import { InventoryCacheService } from '@/lib/inventory-cache';
import { isTeslaFixedVariantSku } from '@/lib/tesla-fixed-variants';
import { fetchTeslaMirrorInventoryItemIds } from '@/lib/tesla-mirror-writes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for batch updates

interface InventoryUpdate {
  sku: string;
  inventoryItemId: string;
  quantity: number;
  locationId: string;
}

interface UpdateRequest {
  updates: InventoryUpdate[];
  reason?: string;
}

function normalizeShopifyId(id: string): string {
  return id.replace(/^gid:\/\/shopify\/(?:InventoryItem|Location)\//, '').trim();
}

// GraphQL mutation for setting inventory quantities
const INVENTORY_SET_QUANTITIES_MUTATION = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors {
        field
        message
      }
      inventoryAdjustmentGroup {
        id
        reason
        referenceDocumentUri
        changes {
          name
          delta
          quantityAfterChange
        }
      }
    }
  }
`;

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check write access
    if (!canWrite(session.user.email)) {
      return NextResponse.json({ error: 'Read-only access. You do not have permission to update inventory.' }, { status: 403 });
    }
    
    // Note: keeping original auth check below for backward compatibility
    if (false) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: UpdateRequest = await request.json();
    const { updates, reason = 'Physical inventory count' } = body;

    if (!updates || updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const shop = process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shop || !accessToken) {
      return NextResponse.json({ error: 'Shopify credentials not configured' }, { status: 500 });
    }

    const normalizedUpdates = updates.map(update => ({
      ...update,
      sku: update.sku.trim(),
      inventoryItemId: normalizeShopifyId(String(update.inventoryItemId)),
      locationId: normalizeShopifyId(String(update.locationId)),
    }));

    const requestedTeslaSkus = Array.from(
      new Set(
        normalizedUpdates
          .map(update => update.sku.trim().toUpperCase())
          .filter(isTeslaFixedVariantSku)
      )
    );

    let teslaMirrorInventoryItemsBySku = new Map<string, string[]>();
    if (requestedTeslaSkus.length > 0) {
      teslaMirrorInventoryItemsBySku = await fetchTeslaMirrorInventoryItemIds({
        shop,
        accessToken,
      });

      const unresolvedSkus = requestedTeslaSkus.filter(
        sku => (teslaMirrorInventoryItemsBySku.get(sku)?.length || 0) < 2
      );
      if (unresolvedSkus.length > 0) {
        return NextResponse.json(
          {
            error: `Unable to resolve mirrored variants for SKU(s): ${unresolvedSkus.join(', ')}`,
          },
          { status: 400 }
        );
      }
    }

    const expandedUpdatesMap = new Map<string, InventoryUpdate>();
    for (const update of normalizedUpdates) {
      const skuUpper = update.sku.trim().toUpperCase();
      const mirrorInventoryItemIds = isTeslaFixedVariantSku(skuUpper)
        ? teslaMirrorInventoryItemsBySku.get(skuUpper) || [update.inventoryItemId]
        : [update.inventoryItemId];

      for (const inventoryItemId of mirrorInventoryItemIds) {
        const normalizedInventoryItemId = normalizeShopifyId(String(inventoryItemId));
        const uniqueKey = `${skuUpper}|${normalizedInventoryItemId}|${update.locationId}`;
        expandedUpdatesMap.set(uniqueKey, {
          ...update,
          inventoryItemId: normalizedInventoryItemId,
        });
      }
    }

    const updatesForValidation = Array.from(expandedUpdatesMap.values());

    // Server-side safety guard: only allow writes for inventoried-tagged products.
    // The cache is built from products tagged "inventoried", so validating against it
    // prevents accidental writes to duplicate SKUs on non-inventoried products.
    const cacheService = new InventoryCacheService();
    const cache = await cacheService.loadCache();
    if (!cache?.inventory?.locationDetails || !cache.inventory.locationIds) {
      return NextResponse.json(
        {
          error: 'Inventory cache not available for validation. Please refresh inventory and try again.',
        },
        { status: 400 }
      );
    }

    const allowedWriteTargets = new Set<string>();
    const allowedSkuByTarget = new Map<string, Set<string>>();
    const { locationDetails, locationIds } = cache.inventory;
    for (const [locationName, details] of Object.entries(locationDetails)) {
      const locationId = locationIds[locationName];
      if (!locationId) continue;

      const normalizedLocationId = normalizeShopifyId(String(locationId));
      for (const detail of details) {
        const normalizedInventoryItemId = normalizeShopifyId(String(detail.inventoryItemId));
        const targetKey = `${normalizedInventoryItemId}|${normalizedLocationId}`;
        allowedWriteTargets.add(targetKey);

        const normalizedSku = detail.sku.trim().toUpperCase();
        const skuSet = allowedSkuByTarget.get(targetKey) || new Set<string>();
        skuSet.add(normalizedSku);
        allowedSkuByTarget.set(targetKey, skuSet);
      }
    }

    if (teslaMirrorInventoryItemsBySku.size > 0) {
      const normalizedLocationIds = Array.from(
        new Set(Object.values(locationIds).map(locationId => normalizeShopifyId(String(locationId))))
      );

      for (const [sku, inventoryItemIds] of teslaMirrorInventoryItemsBySku) {
        for (const normalizedLocationId of normalizedLocationIds) {
          for (const inventoryItemId of inventoryItemIds) {
            const normalizedInventoryItemId = normalizeShopifyId(String(inventoryItemId));
            const targetKey = `${normalizedInventoryItemId}|${normalizedLocationId}`;
            allowedWriteTargets.add(targetKey);

            const skuSet = allowedSkuByTarget.get(targetKey) || new Set<string>();
            skuSet.add(sku);
            allowedSkuByTarget.set(targetKey, skuSet);
          }
        }
      }
    }

    const invalidUpdates = updatesForValidation.filter(update => {
      const targetKey = `${update.inventoryItemId}|${update.locationId}`;
      return !allowedWriteTargets.has(targetKey);
    });

    if (invalidUpdates.length === updatesForValidation.length) {
      const invalidSummary = invalidUpdates
        .slice(0, 10)
        .map(update => `${update.sku} (${update.inventoryItemId}) @ location ${update.locationId}`)
        .join(', ');

      return NextResponse.json(
        {
          error: 'One or more updates do not match inventoried-tagged SKU mappings.',
          details: invalidSummary,
          invalidCount: invalidUpdates.length,
        },
        { status: 400 }
      );
    }

    const validUpdates = updatesForValidation.filter(update => {
      const targetKey = `${update.inventoryItemId}|${update.locationId}`;
      return allowedWriteTargets.has(targetKey);
    });

    const skuMismatchWarnings = validUpdates
      .filter(update => {
        const targetKey = `${update.inventoryItemId}|${update.locationId}`;
        const allowedSkus = allowedSkuByTarget.get(targetKey);
        if (!allowedSkus) return false;
        return !allowedSkus.has(update.sku.toUpperCase());
      })
      .slice(0, 10)
      .map(update => `${update.sku} (${update.inventoryItemId}) @ location ${update.locationId}`);

    if (skuMismatchWarnings.length > 0) {
      console.warn(
        '⚠️ SKU label mismatch for valid inventory targets:',
        skuMismatchWarnings.join(', ')
      );
    }

    const graphqlUrl = `https://${shop}/admin/api/2024-10/graphql.json`;

    if (invalidUpdates.length > 0) {
      const skippedSummary = invalidUpdates
        .slice(0, 10)
        .map(update => `${update.sku} (${update.inventoryItemId}) @ location ${update.locationId}`)
        .join(', ');
      console.warn(
        `⚠️ Skipping ${invalidUpdates.length} non-inventoried updates during submission: ${skippedSummary}`
      );
    }

    console.log(`📦 Updating ${validUpdates.length} inventory items in Shopify...`);

    // Shopify's inventorySetQuantities can handle multiple items at once
    // But there's a limit, so we'll batch them (max 100 per request)
    const batchSize = 100;
    const results: Array<{
      success: boolean;
      sku: string;
      delta?: number;
      quantityAfterChange?: number;
      error?: string;
    }> = [];

    for (let i = 0; i < validUpdates.length; i += batchSize) {
      const batch = validUpdates.slice(i, i + batchSize);
      
      // Build the input for this batch
      const quantities = batch.map(update => ({
        inventoryItemId: `gid://shopify/InventoryItem/${normalizeShopifyId(update.inventoryItemId)}`,
        locationId: `gid://shopify/Location/${normalizeShopifyId(update.locationId)}`,
        quantity: update.quantity,
      }));

      const input = {
        name: 'on_hand',
        reason: 'correction',
        referenceDocumentUri: `app://inventory-dashboard/physical-count/${new Date().toISOString().split('T')[0]}`,
        ignoreCompareQuantity: true,
        quantities,
      };

      try {
        const response = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: INVENTORY_SET_QUANTITIES_MUTATION,
            variables: { input },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ GraphQL request failed: ${response.status}`, errorText);
          batch.forEach(update => {
            results.push({
              success: false,
              sku: update.sku,
              error: `HTTP ${response.status}: ${response.statusText}`,
            });
          });
          continue;
        }

        const data = await response.json();

        if (data.errors) {
          console.error('❌ GraphQL errors:', data.errors);
          batch.forEach(update => {
            results.push({
              success: false,
              sku: update.sku,
              error: data.errors.map((e: { message: string }) => e.message).join(', '),
            });
          });
          continue;
        }

        const result = data.data?.inventorySetQuantities;

        if (result?.userErrors && result.userErrors.length > 0) {
          console.error('❌ User errors:', JSON.stringify(result.userErrors, null, 2));
          console.error('❌ Input that caused error:', JSON.stringify(input, null, 2));
          batch.forEach(update => {
            results.push({
              success: false,
              sku: update.sku,
              error: result.userErrors.map((e: { field?: string[]; message: string }) => 
                e.field ? `${e.field.join('.')}: ${e.message}` : e.message
              ).join(', '),
            });
          });
          continue;
        }

        // Success - map changes back to SKUs
        const changes = result?.inventoryAdjustmentGroup?.changes || [];
        batch.forEach((update, idx) => {
          const change = changes[idx];
          results.push({
            success: true,
            sku: update.sku,
            delta: change?.delta,
            quantityAfterChange: change?.quantityAfterChange,
          });
        });

        console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} updated successfully`);

      } catch (error) {
        console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
        batch.forEach(update => {
          results.push({
            success: false,
            sku: update.sku,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      }

      // Rate limiting between batches
      if (i + batchSize < validUpdates.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`✅ Inventory update complete: ${successCount} success, ${failCount} failed`);

    return NextResponse.json({
      success: failCount === 0,
      summary: {
        total: updates.length,
        validated: validUpdates.length,
        success: successCount,
        failed: failCount,
      },
      skipped: {
        count: invalidUpdates.length,
        details: invalidUpdates
          .slice(0, 25)
          .map(update => ({
            sku: update.sku,
            inventoryItemId: update.inventoryItemId,
            locationId: update.locationId,
          })),
      },
      results,
      updatedBy: session.user.name,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Inventory update failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
