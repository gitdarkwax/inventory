/**
 * Inventory Update API Route
 * Updates inventory quantities in Shopify using GraphQL Admin API
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth, canWrite } from '@/lib/auth';

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

    const graphqlUrl = `https://${shop}/admin/api/2024-10/graphql.json`;

    console.log(`📦 Updating ${updates.length} inventory items in Shopify...`);

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

    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      // Build the input for this batch
      const quantities = batch.map(update => ({
        inventoryItemId: `gid://shopify/InventoryItem/${update.inventoryItemId}`,
        locationId: `gid://shopify/Location/${update.locationId}`,
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
      if (i + batchSize < updates.length) {
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
        success: successCount,
        failed: failCount,
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
