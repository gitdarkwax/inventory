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

const locationOrder = ['LA Office', 'DTLA WH', 'ShipBob', 'China WH'];

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

    // Fetch inventory data
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
        // inboundAir, inboundSea, transferNotes, airTransfers, seaTransfers stay at 0/[]
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
