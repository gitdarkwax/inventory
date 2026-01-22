/**
 * Refresh API Route
 * Fetches fresh inventory and forecasting data from Shopify and caches it
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ShopifyClient } from '@/lib/shopify';
import { ShopifyQLService } from '@/lib/shopifyql';
import { InventoryCacheService } from '@/lib/inventory-cache';

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
    // Verify authorization
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();
    console.log('🔄 Starting inventory refresh...');

    // Fetch inventory data
    const inventoryData = await fetchInventoryData();
    console.log(`✅ Inventory data fetched: ${inventoryData.totalSKUs} SKUs`);

    // Fetch forecasting data
    const forecastingData = await fetchForecastingData();
    console.log(`✅ Forecasting data fetched: ${forecastingData.length} SKUs`);

    // Save to cache
    const cache = new InventoryCacheService();
    await cache.saveCache({
      inventory: inventoryData,
      forecasting: { forecasting: forecastingData },
    });

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
async function fetchInventoryData() {
  const shopify = new ShopifyClient();
  
  // Fetch all locations
  const locations = await shopify.fetchLocations();
  const activeLocations = locations.filter(l => l.active);
  
  // Fetch all products with variants
  const products = await shopify.fetchProducts();
  
  // Build a map of inventory_item_id -> variant info
  // Only include products with the "inventoried" tag
  const variantMap = new Map<string, { sku: string; productTitle: string; variantTitle: string }>();
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
        });
      }
    }
  }
  
  console.log(`📦 Found ${variantMap.size} variants from products tagged "inventoried"`);
  
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
  
  // Group inventory by SKU
  const skuMap = new Map<string, {
    sku: string;
    productTitle: string;
    variantTitle: string;
    locations: Record<string, number>;
    totalAvailable: number;
  }>();
  
  // Also build detailed location data
  const locationDetailMap = new Map<string, Map<string, {
    sku: string;
    productTitle: string;
    variantTitle: string;
    available: number;
    onHand: number;
    committed: number;
    incoming: number;
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
      skuData = {
        sku: variantInfo.sku,
        productTitle: variantInfo.productTitle,
        variantTitle: variantInfo.variantTitle,
        locations: {},
        totalAvailable: 0,
      };
      skuMap.set(variantInfo.sku, skuData);
    }
    
    skuData.locations[level.displayName] = (skuData.locations[level.displayName] || 0) + level.available;
    skuData.totalAvailable += level.available;
    
    // Location detail data
    const locDetailMap = locationDetailMap.get(level.displayName);
    if (locDetailMap) {
      const existing = locDetailMap.get(variantInfo.sku);
      if (existing) {
        existing.available += level.available;
        existing.onHand += level.onHand;
        existing.committed += level.committed;
        existing.incoming += level.incoming;
      } else {
        locDetailMap.set(variantInfo.sku, {
          sku: variantInfo.sku,
          productTitle: variantInfo.productTitle,
          variantTitle: variantInfo.variantTitle,
          available: level.available,
          onHand: level.onHand,
          committed: level.committed,
          incoming: level.incoming,
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
    available: number;
    onHand: number;
    committed: number;
    incoming: number;
  }>> = {};
  
  for (const [locName, skuMapInner] of locationDetailMap) {
    locationDetails[locName] = Array.from(skuMapInner.values()).sort((a, b) => a.sku.localeCompare(b.sku));
  }
  
  // Calculate stats
  const totalSKUs = inventory.length;
  const totalUnits = inventory.reduce((sum, item) => sum + item.totalAvailable, 0);
  const outOfStockCount = inventory.filter(item => item.totalAvailable <= 0).length;
  const lowStockCount = inventory.filter(item => item.totalAvailable > 0 && item.totalAvailable <= 10).length;

  return {
    totalSKUs,
    totalUnits,
    lowStockCount,
    outOfStockCount,
    locations: locationNames,
    inventory,
    locationDetails,
  };
}

/**
 * Fetch forecasting data from Shopify
 */
async function fetchForecastingData() {
  const shopifyQL = new ShopifyQLService();
  return await shopifyQL.getForecastingData();
}
