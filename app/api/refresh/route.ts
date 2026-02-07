/**
 * Refresh API Route
 * Fetches fresh inventory and forecasting data from Shopify and caches it
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ShopifyClient } from '@/lib/shopify';
import { ShopifyQLService, ForecastingData as ForecastingItem } from '@/lib/shopifyql';
// Note: Shopify transfer data is no longer fetched here
// Incoming quantities are now tracked locally from transfers created in our app
import { InventoryCacheService, LowStockAlertCache } from '@/lib/inventory-cache';
import { SlackService, sendSlackNotification } from '@/lib/slack';
import { PhaseOutService } from '@/lib/phase-out-skus';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for all queries

// Location display names and order
const locationDisplayNames: Record<string, string> = {
  'New LA Office': 'LA Office',
  'DTLA Warehouse': 'DTLA WH',
  'ShipBobFulfillment-343151': 'ShipBob',
  'China Warehouse': 'China WH',
};

// Reverse mapping for Shopify location names
const shopifyLocationNames: Record<string, string> = {
  'LA Office': 'New LA Office',
};

const locationOrder = ['LA Office', 'DTLA WH', 'ShipBob', 'China WH'];

// Multi-variant SKUs that need rebalancing at LA Office
// These SKUs map to 2 Shopify variants and need 35%/65% split maintained
const MULTI_VARIANT_SKUS = [
  {
    sku: 'MBT3Y-DG',
    allocations: [
      { variantMatch: 'Model 3', percentage: 0.35 },
      { variantMatch: 'Model Y', percentage: 0.65 },
    ],
  },
  {
    sku: 'MBT3YRH-DG',
    allocations: [
      { variantMatch: 'Model 3', percentage: 0.35 },
      { variantMatch: 'Model Y', percentage: 0.65 },
    ],
  },
];

// GraphQL mutation for adjusting inventory quantities
const INVENTORY_ADJUST_QUANTITIES_MUTATION = `
  mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors {
        field
        message
      }
      inventoryAdjustmentGroup {
        id
        reason
        changes {
          name
          delta
          quantityAfterChange
        }
      }
    }
  }
`;

// GraphQL query to get inventory levels for specific items at a location
const INVENTORY_LEVELS_QUERY = `
  query inventoryLevels($inventoryItemIds: [ID!]!, $locationIds: [ID!]!) {
    inventoryItems(first: 10, query: "") {
      edges {
        node {
          id
          sku
          inventoryLevels(first: 10) {
            edges {
              node {
                id
                location {
                  id
                  name
                }
                quantities(names: ["available", "on_hand"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Rebalance multi-variant SKUs at LA Office to maintain 35%/65% split
 * This runs before fetching inventory data to ensure the split is correct
 * @returns true if any adjustments were made, false otherwise
 */
async function rebalanceMultiVariantSkus(): Promise<boolean> {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!shop || !accessToken) {
    console.log('⚠️ Shopify credentials not configured, skipping rebalance');
    return false;
  }

  const graphqlUrl = `https://${shop}/admin/api/2024-10/graphql.json`;
  const shopify = new ShopifyClient();
  let madeAdjustments = false;

  try {
    console.log('🔄 Checking multi-variant SKU balance at LA Office...');

    // Fetch locations to get LA Office location ID
    const locations = await shopify.fetchLocations();
    const laOfficeLocation = locations.find(l => locationDisplayNames[l.name] === 'LA Office');
    
    if (!laOfficeLocation) {
      console.log('⚠️ LA Office location not found, skipping rebalance');
      return false;
    }

    const laOfficeLocationId = laOfficeLocation.id;
    console.log(`📍 LA Office location ID: ${laOfficeLocationId}`);

    // Fetch all products to find the multi-variant SKU variants
    const products = await shopify.fetchProducts();
    
    // Build a map of SKU -> variants for multi-variant SKUs
    const multiVariantData: Map<string, Array<{
      variantTitle: string;
      inventoryItemId: string;
      sku: string;
      productTitle: string;
    }>> = new Map();

    const targetSkus = MULTI_VARIANT_SKUS.map(m => m.sku);
    console.log(`🔍 Looking for SKUs: ${targetSkus.join(', ')}`);
    console.log(`📦 Total products fetched: ${products.length}`);

    for (const product of products) {
      for (const variant of product.variants) {
        // Check if this variant's SKU is one of our multi-variant SKUs
        if (targetSkus.includes(variant.sku) && variant.inventory_item_id) {
          console.log(`  ✓ Found variant: SKU=${variant.sku}, title="${variant.title}", inventoryItemId=${variant.inventory_item_id}, product="${product.title}"`);
          if (!multiVariantData.has(variant.sku)) {
            multiVariantData.set(variant.sku, []);
          }
          multiVariantData.get(variant.sku)!.push({
            variantTitle: variant.title,
            inventoryItemId: String(variant.inventory_item_id),
            sku: variant.sku,
            productTitle: product.title,
          });
        }
      }
    }
    
    console.log(`📋 Multi-variant SKUs found: ${Array.from(multiVariantData.keys()).join(', ') || 'none'}`);
    for (const [sku, variants] of multiVariantData) {
      console.log(`  ${sku}: ${variants.length} variant(s)`);
      variants.forEach(v => console.log(`    - "${v.variantTitle}" (${v.inventoryItemId})`));
    }

    // For each multi-variant SKU, check and rebalance if needed
    for (const [sku, variants] of multiVariantData) {
      if (variants.length < 2) {
        console.log(`⚠️ ${sku}: Only ${variants.length} variant(s) found, skipping`);
        continue;
      }

      const config = MULTI_VARIANT_SKUS.find(m => m.sku === sku)!;
      
      // Fetch current inventory levels for these variants at LA Office
      const inventoryItemIds = variants.map(v => v.inventoryItemId);
      const levelsResponse = await fetch(`https://${shop}/admin/api/2024-10/inventory_levels.json?inventory_item_ids=${inventoryItemIds.join(',')}&location_ids=${laOfficeLocationId}`, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!levelsResponse.ok) {
        console.error(`❌ Failed to fetch inventory levels for ${sku}`);
        continue;
      }

      const levelsData = await levelsResponse.json();
      const levels = levelsData.inventory_levels || [];

      // Map inventory item ID to current available quantity
      const currentLevels = new Map<string, number>();
      for (const level of levels) {
        currentLevels.set(String(level.inventory_item_id), level.available || 0);
      }

      // Calculate current quantities for each variant
      const variantQuantities: Array<{
        variantTitle: string;
        inventoryItemId: string;
        currentQty: number;
        allocation: { variantMatch: string; percentage: number };
      }> = [];

      console.log(`🔍 ${sku}: Matching variants to allocations...`);
      for (const variant of variants) {
        console.log(`  Checking variant "${variant.variantTitle}" against allocations...`);
        const allocation = config.allocations.find(a => variant.variantTitle.includes(a.variantMatch));
        if (allocation) {
          const qty = currentLevels.get(variant.inventoryItemId) || 0;
          console.log(`    ✓ Matched to ${allocation.variantMatch} (${allocation.percentage * 100}%), current qty: ${qty}`);
          variantQuantities.push({
            variantTitle: variant.variantTitle,
            inventoryItemId: variant.inventoryItemId,
            currentQty: qty,
            allocation,
          });
        } else {
          console.log(`    ✗ No match found for variant title "${variant.variantTitle}"`);
        }
      }

      if (variantQuantities.length !== 2) {
        console.log(`⚠️ ${sku}: Could not match both variants (matched ${variantQuantities.length}), skipping`);
        continue;
      }

      // Calculate total and target quantities
      const totalQty = variantQuantities.reduce((sum, v) => sum + v.currentQty, 0);
      
      if (totalQty === 0) {
        console.log(`ℹ️ ${sku}: Total quantity is 0, nothing to rebalance`);
        continue;
      }

      // Calculate target quantities
      const adjustments: Array<{ inventoryItemId: string; locationId: string; delta: number }> = [];
      let remainingQty = totalQty;

      for (let i = 0; i < variantQuantities.length; i++) {
        const v = variantQuantities[i];
        // Last allocation gets remainder
        const targetQty = i === variantQuantities.length - 1
          ? remainingQty
          : Math.round(totalQty * v.allocation.percentage);
        
        const delta = targetQty - v.currentQty;
        remainingQty -= targetQty;

        console.log(`  📊 ${sku} ${v.allocation.variantMatch}: current=${v.currentQty}, target=${targetQty}, delta=${delta}`);

        if (delta !== 0) {
          adjustments.push({
            inventoryItemId: `gid://shopify/InventoryItem/${v.inventoryItemId}`,
            locationId: `gid://shopify/Location/${laOfficeLocationId}`,
            delta,
          });
        }
      }

      // Apply adjustments if any
      if (adjustments.length > 0) {
        console.log(`🔧 ${sku}: Applying ${adjustments.length} adjustments...`);

        const input = {
          name: 'available',
          reason: 'correction',
          changes: adjustments.map(adj => ({
            inventoryItemId: adj.inventoryItemId,
            locationId: adj.locationId,
            delta: adj.delta,
          })),
        };

        const response = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: INVENTORY_ADJUST_QUANTITIES_MUTATION,
            variables: { input },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ ${sku}: Shopify API error: ${response.status} - ${errorText}`);
          continue;
        }

        const result = await response.json();
        if (result.errors) {
          console.error(`❌ ${sku}: GraphQL errors:`, result.errors);
          continue;
        }

        const userErrors = result.data?.inventoryAdjustQuantities?.userErrors;
        if (userErrors && userErrors.length > 0) {
          console.error(`❌ ${sku}: User errors:`, userErrors);
          continue;
        }

        console.log(`✅ ${sku}: Rebalanced successfully`);
        madeAdjustments = true;
      } else {
        console.log(`✅ ${sku}: Already balanced (total: ${totalQty})`);
      }
    }

    console.log('✅ Multi-variant SKU rebalance check complete');
    return madeAdjustments;
  } catch (error) {
    console.error('❌ Error during rebalance:', error);
    // Don't throw - we want refresh to continue even if rebalance fails
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check if this is an auto-refresh (via cron or internal call)
    const isAutoRefresh = request.headers.get('x-auto-refresh') === 'true';
    
    // Verify authorization (skip for auto-refresh with valid cron secret)
    const cronSecret = request.headers.get('x-cron-secret');
    const isValidCron = cronSecret === process.env.CRON_SECRET;
    
    const session = await auth();
    if (!session?.user && !isValidCron) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Determine who triggered the refresh
    const refreshedBy = isAutoRefresh || isValidCron 
      ? 'hourly auto refresh' 
      : session?.user?.name || 'unknown';

    const startTime = Date.now();
    console.log(`🔄 Starting inventory refresh (by: ${refreshedBy})...`);

    // Step 1: Rebalance multi-variant SKUs at LA Office before fetching data
    const rebalanced = await rebalanceMultiVariantSkus();
    
    // If we made adjustments, wait for Shopify to process them
    if (rebalanced) {
      console.log('⏳ Waiting 2 seconds for Shopify to process rebalance adjustments...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Step 2: Fetch inventory data (now includes rebalanced quantities)
    const inventoryData = await fetchInventoryData();
    console.log(`✅ Inventory data fetched: ${inventoryData.totalSKUs} SKUs`);

    // Fetch forecasting data
    const rawForecastingData = await fetchForecastingData();
    console.log(`✅ Forecasting data fetched: ${rawForecastingData.length} SKUs`);

    // Build SKU to product name map from inventory data
    const skuToProductName = new Map<string, string>();
    for (const item of inventoryData.inventory) {
      skuToProductName.set(item.sku, item.productTitle);
    }

    // Enrich forecasting data with product names from inventory
    const forecastingData = rawForecastingData.map(item => ({
      ...item,
      productName: item.productName || skuToProductName.get(item.sku) || '',
    }));

    // Save to cache (PO data is managed separately via Production Orders)
    const cache = new InventoryCacheService();
    await cache.saveCache({
      inventory: inventoryData,
      forecasting: { forecasting: forecastingData },
    }, refreshedBy);

    // Get phase out SKUs for low stock alert logic
    let phaseOutSkus: string[] = [];
    try {
      const phaseOutData = await PhaseOutService.getPhaseOutSKUs();
      phaseOutSkus = phaseOutData.skus.map(s => s.sku);
    } catch (error) {
      console.warn('⚠️ Could not load phase out SKUs for alert logic:', error);
    }

    // Check for low stock in LA area (LA Office + DTLA WH) and send alerts
    await checkLowStockAlerts(cache, inventoryData, forecastingData, phaseOutSkus);

    const duration = Date.now() - startTime;
    console.log(`✅ Refresh complete in ${duration}ms`);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      data: {
        inventory: {
          totalSKUs: inventoryData.totalSKUs,
          totalUnits: inventoryData.totalUnits,
          locations: inventoryData.locations.length,
        },
        forecasting: {
          totalSKUs: forecastingData.length,
        },
      },
    });

  } catch (error) {
    console.error('❌ Refresh failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// Also allow POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}

/**
 * Fetch inventory data from Shopify
 */
export async function fetchInventoryData() {
  const shopify = new ShopifyClient();
  
  // Fetch all locations
  const locations = await shopify.fetchLocations();
  const activeLocations = locations.filter(l => l.active);
  
  // Fetch all products with variants
  const products = await shopify.fetchProducts();
  
  // Build a map of inventory_item_id -> variant info
  // Only include products with the "inventoried" tag
  const variantMap = new Map<string, { sku: string; productTitle: string; variantTitle: string; inventoryItemId: string }>();
  for (const product of products) {
    // Check if product has the "inventoried" tag (tags is a comma-separated string)
    const productTags = product.tags?.toLowerCase().split(',').map(t => t.trim()) || [];
    if (!productTags.includes('inventoried')) {
      continue; // Skip products without the "inventoried" tag
    }
    
    for (const variant of product.variants) {
      if (variant.sku && variant.inventory_item_id) {
        variantMap.set(String(variant.inventory_item_id), {
          sku: variant.sku,
          productTitle: product.title,
          variantTitle: variant.title,
          inventoryItemId: String(variant.inventory_item_id),
        });
      }
    }
  }
  
  console.log(`📦 Found ${variantMap.size} variants from products tagged "inventoried"`);
  
  // Note: Shopify transfer data is no longer fetched
  // Incoming quantities (In Air, In Sea) are tracked locally from transfers created in our app
  // The Dashboard merges local transfer data with this inventory data
  
  // Fetch detailed inventory levels for each location
  interface DetailedLevel {
    inventoryItemId: string;
    available: number;
    onHand: number;
    committed: number;
    incoming: number;
    locationName: string;
    displayName: string;
  }
  
  const allDetailedLevels: DetailedLevel[] = [];
  
  for (const location of activeLocations) {
    const displayName = locationDisplayNames[location.name] || location.name;
    const levels = await shopify.fetchDetailedInventoryLevels(location.id);
    allDetailedLevels.push(...levels.map(level => ({
      ...level,
      locationName: location.name,
      displayName,
    })));
  }
  
  // Transfer info for hover tooltip
  interface TransferDetailInfo {
    id: string;
    name: string;
    quantity: number;
    tags: string[];
    note: string | null;
    createdAt: string;
    expectedArrivalAt: string | null;
  }

  // Group inventory by SKU
  const skuMap = new Map<string, {
    sku: string;
    productTitle: string;
    variantTitle: string;
    locations: Record<string, number>;
    totalAvailable: number;
    inTransit: number;
    transferDetails: TransferDetailInfo[];
  }>();
  
  // Also build detailed location data
  const locationDetailMap = new Map<string, Map<string, {
    sku: string;
    productTitle: string;
    variantTitle: string;
    inventoryItemId: string;
    available: number;
    onHand: number;
    committed: number;
    incoming: number;
    inboundAir: number;
    inboundSea: number;
    transferNotes: Array<{ id: string; note: string | null }>;
    airTransfers: TransferDetailInfo[];
    seaTransfers: TransferDetailInfo[];
    // For SKUs that map to multiple Shopify variants (e.g., MBT3Y-DG)
    variantInventoryItems?: Array<{ inventoryItemId: string; variantTitle: string; onHand: number }>;
  }>>();
  
  // Initialize location detail maps
  for (const loc of activeLocations) {
    const displayName = locationDisplayNames[loc.name] || loc.name;
    locationDetailMap.set(displayName, new Map());
  }
  
  for (const level of allDetailedLevels) {
    const variantInfo = variantMap.get(level.inventoryItemId);
    if (!variantInfo) continue;
    
    // Main view data
    let skuData = skuMap.get(variantInfo.sku);
    if (!skuData) {
      // Note: inTransit and transferDetails are now set to 0/empty
      // Incoming is tracked locally from transfers created in our app
      skuData = {
        sku: variantInfo.sku,
        productTitle: variantInfo.productTitle,
        variantTitle: variantInfo.variantTitle,
        locations: {},
        totalAvailable: 0,
        inTransit: 0, // Now tracked locally from app transfers
        transferDetails: [], // Now tracked locally from app transfers
      };
      skuMap.set(variantInfo.sku, skuData);
    }
    
    skuData.locations[level.displayName] = (skuData.locations[level.displayName] || 0) + level.available;
    skuData.totalAvailable += level.available;
    
    // Location detail data
    const locDetailMap = locationDetailMap.get(level.displayName);
    if (locDetailMap) {
      // Note: inboundAir, inboundSea, airTransfers, seaTransfers are now set to 0/empty
      // These are tracked locally from transfers created in our app and merged in the Dashboard
      
      const existing = locDetailMap.get(variantInfo.sku);
      if (existing) {
        existing.available += level.available;
        existing.onHand += level.onHand;
        existing.committed += level.committed;
        existing.incoming += level.incoming;
        // Track multiple variants for the same SKU (e.g., MBT3Y-DG has 2 variants)
        if (!existing.variantInventoryItems) {
          // Initialize with the first variant that was already stored
          existing.variantInventoryItems = [{
            inventoryItemId: existing.inventoryItemId,
            variantTitle: existing.variantTitle,
            onHand: existing.onHand - level.onHand, // Subtract what we just added to get original
          }];
        }
        // Add this variant
        existing.variantInventoryItems.push({
          inventoryItemId: variantInfo.inventoryItemId,
          variantTitle: variantInfo.variantTitle,
          onHand: level.onHand,
        });
      } else {
        locDetailMap.set(variantInfo.sku, {
          sku: variantInfo.sku,
          productTitle: variantInfo.productTitle,
          variantTitle: variantInfo.variantTitle,
          inventoryItemId: variantInfo.inventoryItemId,
          available: level.available,
          onHand: level.onHand,
          committed: level.committed,
          incoming: level.incoming,
          inboundAir: 0, // Tracked locally from app transfers
          inboundSea: 0, // Tracked locally from app transfers
          transferNotes: [], // Tracked locally from app transfers
          airTransfers: [], // Tracked locally from app transfers
          seaTransfers: [], // Tracked locally from app transfers
          variantInventoryItems: undefined, // Will be set if there are multiple variants
        });
      }
    }
  }
  
  const inventory = Array.from(skuMap.values()).sort((a, b) => a.sku.localeCompare(b.sku));
  
  // Get ordered location names
  const locationNames = locationOrder.filter(name => 
    activeLocations.some(l => locationDisplayNames[l.name] === name)
  );
  
  // Build location details object
  const locationDetails: Record<string, Array<{
    sku: string;
    productTitle: string;
    variantTitle: string;
    inventoryItemId: string;
    available: number;
    onHand: number;
    committed: number;
    incoming: number;
    inboundAir: number;
    inboundSea: number;
    transferNotes: Array<{ id: string; note: string | null }>;
    airTransfers: TransferDetailInfo[];
    seaTransfers: TransferDetailInfo[];
    variantInventoryItems?: Array<{ inventoryItemId: string; variantTitle: string; onHand: number }>;
  }>> = {};
  
  for (const [locName, skuMapInner] of locationDetailMap) {
    locationDetails[locName] = Array.from(skuMapInner.values()).sort((a, b) => a.sku.localeCompare(b.sku));
  }
  
  // Calculate stats
  const totalSKUs = inventory.length;
  const totalUnits = inventory.reduce((sum, item) => sum + item.totalAvailable, 0);
  const outOfStockCount = inventory.filter(item => item.totalAvailable <= 0).length;
  const lowStockCount = inventory.filter(item => item.totalAvailable > 0 && item.totalAvailable <= 10).length;

  // Build location ID map (display name -> Shopify location ID)
  const locationIds: Record<string, string> = {};
  for (const loc of activeLocations) {
    const displayName = locationDisplayNames[loc.name] || loc.name;
    locationIds[displayName] = loc.id;
  }

  return {
    totalSKUs,
    totalUnits,
    lowStockCount,
    outOfStockCount,
    locations: locationNames,
    locationIds,
    inventory,
    locationDetails,
  };
}

/**
 * Fetch forecasting data from Shopify
 */
export async function fetchForecastingData() {
  const shopifyQL = new ShopifyQLService();
  return await shopifyQL.getForecastingData();
}

/**
 * Check for low stock in LA area (LA Office + DTLA WH combined) and send Slack alerts
 * Uses tiered alert system based on stock level and runway days
 * 
 * Alert Logic:
 * - LA < 200 & Runway Air > 90 days → No alert (plenty of runway)
 * - LA < 200 & Runway Air < 90 days → Low stock alert
 * - LA < 200 & Runway Air < 90 days & Phase Out → Low stock alert (noted as phase out)
 * - LA < 50 & Runway Air < 90 days → Critical alert (once until restocked)
 * - LA <= 0 → Zero stock alert
 * - LA <= 0 & Phase Out → Zero stock alert (noted as phase out)
 */
export async function checkLowStockAlerts(
  cache: InventoryCacheService,
  inventoryData: Awaited<ReturnType<typeof fetchInventoryData>>,
  forecastingData: ForecastingItem[],
  phaseOutSkus: string[]
): Promise<void> {
  const LOW_STOCK_THRESHOLD = 200;
  const CRITICAL_THRESHOLD = 50;
  const RUNWAY_THRESHOLD = 90; // days
  const LOCATION_LABEL = 'LA';

  try {
    // Get inventory details for both LA locations
    const laOfficeDetails = inventoryData.locationDetails['LA Office'] || [];
    const dtlaDetails = inventoryData.locationDetails['DTLA WH'] || [];
    
    if (laOfficeDetails.length === 0 && dtlaDetails.length === 0) {
      console.log(`ℹ️ No inventory data for LA Area`);
      return;
    }

    // Get incoming inventory for air shipments
    const incomingInventory = await cache.getIncomingInventory();
    
    // Build burn rate map from forecasting data (use 21-day average)
    const burnRateMap = new Map<string, number>();
    for (const item of forecastingData) {
      burnRateMap.set(item.sku, item.avgDaily21d);
    }

    // Build phase out set for quick lookup (case insensitive)
    const phaseOutSet = new Set(phaseOutSkus.map(s => s.toLowerCase()));

    // Build a map of SKU -> combined LA quantity and variant info
    const skuInventory = new Map<string, { quantity: number; variantTitle: string }>();
    
    // Add LA Office quantities
    for (const item of laOfficeDetails) {
      skuInventory.set(item.sku, {
        quantity: item.available,
        variantTitle: item.variantTitle,
      });
    }
    
    // Add DTLA WH quantities (combine with existing)
    for (const item of dtlaDetails) {
      const existing = skuInventory.get(item.sku);
      if (existing) {
        existing.quantity += item.available;
      } else {
        skuInventory.set(item.sku, {
          quantity: item.available,
          variantTitle: item.variantTitle,
        });
      }
    }

    // Calculate incoming air for each SKU (across all destinations going to LA)
    const getIncomingAir = (sku: string): number => {
      let total = 0;
      // Check LA Office and DTLA WH destinations
      for (const dest of ['LA Office', 'DTLA WH']) {
        const destData = incomingInventory[dest];
        if (destData?.[sku]) {
          total += destData[sku].inboundAir;
        }
      }
      return total;
    };

    // Get existing alerts
    const existingAlerts = await cache.getLowStockAlerts();
    
    // Categorize SKUs for alerts
    const newAlerts: LowStockAlertCache = {};
    const lowStockToAlert: Array<{ sku: string; variantName: string; quantity: number; runwayDays: number; isPhaseOut: boolean }> = [];
    const criticalToAlert: Array<{ sku: string; variantName: string; quantity: number; runwayDays: number; isPhaseOut: boolean }> = [];
    const zeroStockToAlert: Array<{ sku: string; variantName: string; isPhaseOut: boolean }> = [];

    for (const [sku, data] of skuInventory) {
      const laQuantity = data.quantity;
      const incomingAir = getIncomingAir(sku);
      const burnRate = burnRateMap.get(sku) || 0;
      const isPhaseOut = phaseOutSet.has(sku.toLowerCase());
      
      // Calculate Runway Air: (LA inventory + Air incoming) / burn rate
      const runwayAir = burnRate > 0 ? Math.round((laQuantity + incomingAir) / burnRate) : 999;
      
      const previousAlert = existingAlerts[sku];

      // Determine alert type based on tiered logic
      if (laQuantity <= 0) {
        // ZERO STOCK - always alert
        if (!previousAlert || previousAlert.type !== 'zero') {
          zeroStockToAlert.push({
            sku,
            variantName: data.variantTitle,
            isPhaseOut,
          });
        }
        newAlerts[sku] = { type: 'zero', quantity: laQuantity };
        
      } else if (laQuantity < CRITICAL_THRESHOLD && runwayAir < RUNWAY_THRESHOLD) {
        // CRITICAL (<50 units with <90 days runway)
        if (!previousAlert || previousAlert.type !== 'critical') {
          criticalToAlert.push({
            sku,
            variantName: data.variantTitle,
            quantity: laQuantity,
            runwayDays: runwayAir,
            isPhaseOut,
          });
        }
        newAlerts[sku] = { type: 'critical', quantity: laQuantity };
        
      } else if (laQuantity < LOW_STOCK_THRESHOLD && runwayAir < RUNWAY_THRESHOLD) {
        // LOW STOCK (<200 units with <90 days runway)
        if (!previousAlert || previousAlert.type !== 'low') {
          lowStockToAlert.push({
            sku,
            variantName: data.variantTitle,
            quantity: laQuantity,
            runwayDays: runwayAir,
            isPhaseOut,
          });
        }
        newAlerts[sku] = { type: 'low', quantity: laQuantity };
        
      } else if (laQuantity < LOW_STOCK_THRESHOLD && runwayAir >= RUNWAY_THRESHOLD) {
        // Low quantity but plenty of runway - no alert needed
        // Don't add to newAlerts (clears any previous alert)
        if (previousAlert) {
          console.log(`✅ ${sku}: ${laQuantity} units but ${runwayAir}d runway - no alert needed`);
        }
        
      } else if (previousAlert) {
        // SKU was previously alerted but is now above threshold - clear alert
        console.log(`📈 ${sku} restocked to ${laQuantity} units (was ${previousAlert.type} alert)`);
      }
    }

    // Replace the entire alerts cache - this removes restocked SKUs
    await cache.setLowStockAlerts(newAlerts);

    // Send Slack notification for new alerts
    const totalNewAlerts = lowStockToAlert.length + criticalToAlert.length + zeroStockToAlert.length;
    
    if (totalNewAlerts > 0) {
      console.log(`⚠️ Sending stock alerts: ${zeroStockToAlert.length} zero, ${criticalToAlert.length} critical, ${lowStockToAlert.length} low`);
      
      sendSlackNotification(async () => {
        const alertsChannelId = process.env.SLACK_CHANNEL_ALERTS;
        if (!alertsChannelId) {
          throw new Error('SLACK_CHANNEL_ALERTS not configured');
        }
        
        const slack = new SlackService(alertsChannelId);
        await slack.notifyLowStockTiered({
          lowStockItems: lowStockToAlert,
          criticalItems: criticalToAlert,
          zeroStockItems: zeroStockToAlert,
          location: LOCATION_LABEL,
        });
      }, 'SLACK_CHANNEL_ALERTS');
    } else {
      const trackedCount = Object.keys(newAlerts).length;
      console.log(`✅ No new stock alerts needed (${trackedCount} SKUs being tracked)`);
    }

  } catch (error) {
    console.error('⚠️ Error checking low stock alerts:', error);
    // Don't throw - low stock check failure shouldn't fail the refresh
  }
}
