/**
 * Inventory API Route
 * Fetches inventory data from Shopify via REST API
 */

import { NextResponse } from 'next/server';
import { ShopifyClient } from '@/lib/shopify';

export const dynamic = 'force-dynamic';

// Location display names and order
const locationDisplayNames: Record<string, string> = {
  'New LA Office': 'LA Office',
  'DTLA Warehouse': 'DTLA WH',
  'ShipBobFulfillment-343151': 'ShipBob',
  'China Warehouse': 'China WH',
};

const locationOrder = ['LA Office', 'DTLA WH', 'ShipBob', 'China WH'];

export async function GET() {
  try {
    console.log('📦 Fetching inventory data from Shopify...');
    
    const shopify = new ShopifyClient();
    
    // Fetch all locations first
    const locations = await shopify.fetchLocations();
    const activeLocations = locations.filter(l => l.active);
    console.log(`✅ Found ${activeLocations.length} active locations:`, activeLocations.map(l => l.name));
    
    // Fetch all products with variants
    const products = await shopify.fetchProducts();
    console.log(`✅ Found ${products.length} products`);
    
    // Build a map of inventory_item_id -> variant info
    const variantMap = new Map<string, { sku: string; productTitle: string; variantTitle: string }>();
    for (const product of products) {
      for (const variant of product.variants) {
        if (variant.sku && variant.inventory_item_id) {
          // Store with string ID to match GraphQL format
          variantMap.set(String(variant.inventory_item_id), {
            sku: variant.sku,
            productTitle: product.title,
            variantTitle: variant.title,
          });
        }
      }
    }
    console.log(`📋 Built variant map with ${variantMap.size} entries`);
    // Log a sample entry
    const sampleEntry = variantMap.entries().next().value;
    if (sampleEntry) {
      console.log(`📋 Sample variant map entry: ID="${sampleEntry[0]}", SKU="${sampleEntry[1].sku}"`);
    }
    
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
      console.log(`📡 Fetching detailed inventory for location: ${location.name} (${displayName})`);
      
      const levels = await shopify.fetchDetailedInventoryLevels(location.id);
      allDetailedLevels.push(...levels.map(level => ({
        ...level,
        locationName: location.name,
        displayName,
      })));
    }
    console.log(`✅ Found ${allDetailedLevels.length} detailed inventory level records`);
    // Log a sample entry
    if (allDetailedLevels.length > 0) {
      console.log(`📋 Sample detailed level: inventoryItemId="${allDetailedLevels[0].inventoryItemId}"`);
    }
    
    // Group inventory by SKU with per-location breakdown (available only for main view)
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
      
      // Main view data (available only)
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
    
    for (const [locName, skuMap] of locationDetailMap) {
      locationDetails[locName] = Array.from(skuMap.values()).sort((a, b) => a.sku.localeCompare(b.sku));
    }
    
    // Calculate stats
    const totalSKUs = inventory.length;
    const totalUnits = inventory.reduce((sum, item) => sum + item.totalAvailable, 0);
    const outOfStockCount = inventory.filter(item => item.totalAvailable <= 0).length;
    const lowStockCount = inventory.filter(item => item.totalAvailable > 0 && item.totalAvailable <= 10).length;
    
    console.log(`✅ Loaded ${totalSKUs} SKUs across ${locationNames.length} locations`);

    return NextResponse.json({
      totalSKUs,
      totalUnits,
      lowStockCount,
      outOfStockCount,
      locations: locationNames,
      inventory,
      locationDetails,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to fetch inventory:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch inventory' },
      { status: 500 }
    );
  }
}
