/**
 * Inventory Cache Service
 * Uses Google Drive for persistent storage in production (Vercel)
 * Uses local files for development
 */

import fs from 'fs';
import path from 'path';
import { GoogleDriveCacheService } from './google-drive-cache';

// Types for cached data
export interface TransferDetailInfo {
  id: string;
  name: string;
  quantity: number;
  tags: string[];
  note: string | null;
  createdAt: string;
  expectedArrivalAt: string | null;
}

export interface InventoryByLocation {
  sku: string;
  productTitle: string;
  variantTitle: string;
  locations: Record<string, number>;
  totalAvailable: number;
  inTransit: number;
  transferDetails: TransferDetailInfo[];
}

export interface LocationDetail {
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
}

export interface ForecastingItem {
  sku: string;
  productName: string;
  avgDaily7d: number;
  avgDaily21d: number;
  avgDaily90d: number;
  avgDailyLastYear30d: number;
}

export interface PurchaseOrderItem {
  sku: string;
  pendingQuantity: number;
}

// Incoming inventory tracked from app transfers (not Shopify)
export interface IncomingTransferDetail {
  transferId: string;
  quantity: number;
  note: string | null;
  createdAt: string;
}

export interface IncomingInventoryBySku {
  inboundAir: number;
  inboundSea: number;
  airTransfers: IncomingTransferDetail[];
  seaTransfers: IncomingTransferDetail[];
}

// destination -> sku -> incoming data
export type IncomingInventoryCache = Record<string, Record<string, IncomingInventoryBySku>>;

// Track low stock alerts to avoid duplicates
// sku -> last alerted quantity (only send new alert if quantity changed after going above threshold)
export type LowStockAlertCache = Record<string, number>;

export interface CachedInventoryData {
  inventory: {
    totalSKUs: number;
    totalUnits: number;
    lowStockCount: number;
    outOfStockCount: number;
    locations: string[];
    locationIds: Record<string, string>; // location display name -> Shopify location ID
    inventory: InventoryByLocation[];
    locationDetails: Record<string, LocationDetail[]>;
  };
  forecasting: {
    forecasting: ForecastingItem[];
  };
  purchaseOrders?: {
    purchaseOrders: PurchaseOrderItem[];
  };
  // Incoming inventory from app transfers (Air/Sea shipments in transit)
  incomingInventory?: IncomingInventoryCache;
  // Track which SKUs have been alerted for low stock (to avoid duplicate alerts)
  lowStockAlerts?: LowStockAlertCache;
  lastUpdated: string;
  refreshedBy?: string; // User name or "hourly auto refresh"
}

export class InventoryCacheService {
  private cacheDir: string;
  private cacheFile: string;

  constructor() {
    // Use /tmp in production (Vercel), .next/cache locally
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      this.cacheDir = '/tmp/cache';
    } else {
      this.cacheDir = path.join(process.cwd(), '.next', 'cache');
    }
    
    this.cacheFile = path.join(this.cacheDir, 'inventory-cache.json');
    
    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Save inventory data to cache
   * IMPORTANT: This preserves existing incomingInventory if not provided in data
   */
  async saveCache(data: Omit<CachedInventoryData, 'lastUpdated' | 'refreshedBy'>, refreshedBy?: string): Promise<void> {
    // Load existing cache to preserve incomingInventory
    // Retry up to 3 times if loading fails to avoid losing incoming data
    let existingCache: CachedInventoryData | null = null;
    let loadAttempts = 0;
    const maxAttempts = 3;
    
    while (loadAttempts < maxAttempts) {
      loadAttempts++;
      existingCache = await this.loadCache();
      if (existingCache) {
        console.log(`✅ Loaded existing cache on attempt ${loadAttempts}`);
        break;
      } else {
        console.warn(`⚠️ Cache load returned null (attempt ${loadAttempts}/${maxAttempts})`);
        if (loadAttempts < maxAttempts) {
          // Wait 1 second before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // Log what we're preserving
    const existingIncoming = existingCache?.incomingInventory;
    const hasExistingIncoming = existingIncoming && Object.keys(existingIncoming).length > 0;
    if (hasExistingIncoming) {
      const destinations = Object.keys(existingIncoming);
      const totalSkus = destinations.reduce((sum, dest) => sum + Object.keys(existingIncoming[dest] || {}).length, 0);
      console.log(`📦 Preserving existing incomingInventory: ${totalSkus} SKUs across ${destinations.length} destinations`);
    } else if (!existingCache) {
      console.warn(`⚠️ Could not load existing cache after ${maxAttempts} attempts - incomingInventory may be lost!`);
    } else {
      console.log(`📭 No existing incomingInventory to preserve`);
    }
    
    const cacheData: CachedInventoryData = {
      ...data,
      // Preserve existing incomingInventory if not being explicitly updated
      incomingInventory: data.incomingInventory || existingCache?.incomingInventory || {},
      // Preserve existing lowStockAlerts if not being explicitly updated
      lowStockAlerts: data.lowStockAlerts || existingCache?.lowStockAlerts || {},
      lastUpdated: new Date().toISOString(),
      refreshedBy: refreshedBy || 'unknown',
    };

    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      // Use Google Drive in production
      await GoogleDriveCacheService.saveCache(cacheData);
    } else {
      // Use local file in development
      fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2), 'utf-8');
      console.log('💾 Saved inventory cache locally');
    }
  }

  /**
   * Load inventory data from cache
   */
  async loadCache(): Promise<CachedInventoryData | null> {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      // Use Google Drive in production
      try {
        return await GoogleDriveCacheService.loadCache<CachedInventoryData>();
      } catch (error) {
        console.error('Error loading cache from Google Drive:', error);
        return null;
      }
    } else {
      // Use local file in development
      if (!fs.existsSync(this.cacheFile)) {
        return null;
      }

      try {
        const data = fs.readFileSync(this.cacheFile, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error loading local cache:', error);
        return null;
      }
    }
  }

  /**
   * Check if cache exists
   */
  async hasCache(): Promise<boolean> {
    const cache = await this.loadCache();
    return cache !== null;
  }

  /**
   * Get cache age in minutes
   */
  async getCacheAge(): Promise<number | null> {
    const cache = await this.loadCache();
    if (!cache?.lastUpdated) return null;
    
    const lastUpdated = new Date(cache.lastUpdated).getTime();
    return Math.floor((Date.now() - lastUpdated) / 1000 / 60);
  }

  /**
   * Add incoming inventory when a transfer is marked "In Transit" (Air/Sea only)
   * @param destination - The destination location (e.g., "LA Office")
   * @param shipmentType - "Air Express", "Air Slow", or "Sea"
   * @param items - Array of { sku, quantity } being transferred
   * @param transferId - The transfer ID for tracking
   * @param createdAt - When the transfer was created
   * @param note - Optional note for the transfer
   */
  async addToIncoming(
    destination: string,
    shipmentType: 'Air Express' | 'Air Slow' | 'Sea',
    items: Array<{ sku: string; quantity: number }>,
    transferId: string,
    createdAt: string,
    note?: string | null
  ): Promise<void> {
    // Retry loading cache up to 3 times
    let cache: CachedInventoryData | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      cache = await this.loadCache();
      if (cache) break;
      console.warn(`⚠️ addToIncoming: cache load attempt ${attempt}/3 failed`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!cache) {
      console.error('❌ Cannot add to incoming: cache not loaded after 3 attempts');
      throw new Error('Failed to load cache for addToIncoming');
    }

    // Initialize incoming inventory if not exists
    if (!cache.incomingInventory) {
      cache.incomingInventory = {};
    }
    if (!cache.incomingInventory[destination]) {
      cache.incomingInventory[destination] = {};
    }

    const isAir = shipmentType === 'Air Express' || shipmentType === 'Air Slow';
    const isSea = shipmentType === 'Sea';

    for (const item of items) {
      if (!cache.incomingInventory[destination][item.sku]) {
        cache.incomingInventory[destination][item.sku] = {
          inboundAir: 0,
          inboundSea: 0,
          airTransfers: [],
          seaTransfers: [],
        };
      }

      const skuData = cache.incomingInventory[destination][item.sku];
      const transferDetail: IncomingTransferDetail = {
        transferId,
        quantity: item.quantity,
        note: note || null,
        createdAt,
      };

      if (isAir) {
        skuData.inboundAir += item.quantity;
        skuData.airTransfers.push(transferDetail);
      } else if (isSea) {
        skuData.inboundSea += item.quantity;
        skuData.seaTransfers.push(transferDetail);
      }
    }

    // Save updated cache
    await this.saveFullCache(cache);
    console.log(`✅ Added incoming to cache: ${items.length} SKUs for ${destination} (${shipmentType})`);
  }

  /**
   * Subtract from incoming inventory when delivery is logged
   * @param destination - The destination location
   * @param shipmentType - "Air Express", "Air Slow", or "Sea"
   * @param items - Array of { sku, quantity } being received
   * @param transferId - The transfer ID to update
   */
  async subtractFromIncoming(
    destination: string,
    shipmentType: 'Air Express' | 'Air Slow' | 'Sea',
    items: Array<{ sku: string; quantity: number }>,
    transferId: string
  ): Promise<void> {
    const cache = await this.loadCache();
    if (!cache?.incomingInventory?.[destination]) {
      console.warn('⚠️ No incoming inventory to subtract from');
      return;
    }

    const isAir = shipmentType === 'Air Express' || shipmentType === 'Air Slow';
    const isSea = shipmentType === 'Sea';

    for (const item of items) {
      const skuData = cache.incomingInventory[destination][item.sku];
      if (!skuData) continue;

      if (isAir) {
        skuData.inboundAir = Math.max(0, skuData.inboundAir - item.quantity);
        // Update the transfer detail quantity or remove if fully delivered
        const transferIdx = skuData.airTransfers.findIndex(t => t.transferId === transferId);
        if (transferIdx >= 0) {
          skuData.airTransfers[transferIdx].quantity -= item.quantity;
          if (skuData.airTransfers[transferIdx].quantity <= 0) {
            skuData.airTransfers.splice(transferIdx, 1);
          }
        }
      } else if (isSea) {
        skuData.inboundSea = Math.max(0, skuData.inboundSea - item.quantity);
        // Update the transfer detail quantity or remove if fully delivered
        const transferIdx = skuData.seaTransfers.findIndex(t => t.transferId === transferId);
        if (transferIdx >= 0) {
          skuData.seaTransfers[transferIdx].quantity -= item.quantity;
          if (skuData.seaTransfers[transferIdx].quantity <= 0) {
            skuData.seaTransfers.splice(transferIdx, 1);
          }
        }
      }

      // Clean up empty SKU entries
      if (skuData.inboundAir === 0 && skuData.inboundSea === 0) {
        delete cache.incomingInventory[destination][item.sku];
      }
    }

    // Clean up empty destination entries
    if (Object.keys(cache.incomingInventory[destination]).length === 0) {
      delete cache.incomingInventory[destination];
    }

    // Save updated cache
    await this.saveFullCache(cache);
    console.log(`✅ Subtracted incoming from cache: ${items.length} SKUs for ${destination}`);
  }

  /**
   * Remove a transfer from incoming (when cancelled or deleted)
   * @param destination - The destination location
   * @param transferId - The transfer ID to remove
   */
  async removeTransferFromIncoming(
    destination: string,
    transferId: string
  ): Promise<void> {
    const cache = await this.loadCache();
    if (!cache?.incomingInventory?.[destination]) {
      return;
    }

    for (const sku of Object.keys(cache.incomingInventory[destination])) {
      const skuData = cache.incomingInventory[destination][sku];
      
      // Remove from air transfers
      const airIdx = skuData.airTransfers.findIndex(t => t.transferId === transferId);
      if (airIdx >= 0) {
        skuData.inboundAir -= skuData.airTransfers[airIdx].quantity;
        skuData.airTransfers.splice(airIdx, 1);
      }

      // Remove from sea transfers
      const seaIdx = skuData.seaTransfers.findIndex(t => t.transferId === transferId);
      if (seaIdx >= 0) {
        skuData.inboundSea -= skuData.seaTransfers[seaIdx].quantity;
        skuData.seaTransfers.splice(seaIdx, 1);
      }

      // Clean up empty SKU entries
      if (skuData.inboundAir <= 0 && skuData.inboundSea <= 0) {
        delete cache.incomingInventory[destination][sku];
      }
    }

    // Clean up empty destination entries
    if (Object.keys(cache.incomingInventory[destination]).length === 0) {
      delete cache.incomingInventory[destination];
    }

    await this.saveFullCache(cache);
    console.log(`✅ Removed transfer ${transferId} from incoming cache`);
  }

  /**
   * Get incoming inventory from cache
   */
  async getIncomingInventory(): Promise<IncomingInventoryCache> {
    const cache = await this.loadCache();
    return cache?.incomingInventory || {};
  }

  /**
   * Set the entire incoming inventory (used for rebuild)
   * This is more reliable than calling addToIncoming multiple times
   */
  async setIncomingInventory(incomingInventory: IncomingInventoryCache): Promise<void> {
    // Retry loading cache up to 3 times
    let cache: CachedInventoryData | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      cache = await this.loadCache();
      if (cache) break;
      console.warn(`⚠️ setIncomingInventory: cache load attempt ${attempt}/3 failed`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!cache) {
      console.error('❌ Cannot set incoming inventory: cache not loaded after 3 attempts');
      throw new Error('Failed to load cache for setIncomingInventory');
    }

    cache.incomingInventory = incomingInventory;
    await this.saveFullCache(cache);
    
    const destinations = Object.keys(incomingInventory);
    const totalSkus = destinations.reduce((sum, dest) => sum + Object.keys(incomingInventory[dest] || {}).length, 0);
    console.log(`✅ Set incoming inventory: ${totalSkus} SKUs across ${destinations.length} destinations`);
  }

  /**
   * Save full cache (internal helper)
   */
  private async saveFullCache(cache: CachedInventoryData): Promise<void> {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      await GoogleDriveCacheService.saveCache(cache);
    } else {
      fs.writeFileSync(this.cacheFile, JSON.stringify(cache, null, 2), 'utf-8');
    }
  }

  /**
   * Get low stock alerts tracking data
   */
  async getLowStockAlerts(): Promise<LowStockAlertCache> {
    const cache = await this.loadCache();
    return cache?.lowStockAlerts || {};
  }

  /**
   * Set low stock alerts tracking (replaces existing alerts entirely)
   * @param alerts - Record of SKU -> quantity that was alerted
   */
  async setLowStockAlerts(alerts: LowStockAlertCache): Promise<void> {
    const cache = await this.loadCache();
    if (!cache) {
      console.warn('⚠️ Cannot set low stock alerts: cache not loaded');
      return;
    }

    // Replace entirely - this removes SKUs that are no longer low stock
    cache.lowStockAlerts = alerts;

    await this.saveFullCache(cache);
    console.log(`✅ Set low stock alerts: ${Object.keys(alerts).length} SKUs tracked`);
  }

  /**
   * Clear a low stock alert when SKU is restocked above threshold
   * @param sku - The SKU to clear
   */
  async clearLowStockAlert(sku: string): Promise<void> {
    const cache = await this.loadCache();
    if (!cache?.lowStockAlerts?.[sku]) {
      return;
    }

    delete cache.lowStockAlerts[sku];
    await this.saveFullCache(cache);
    console.log(`✅ Cleared low stock alert for ${sku}`);
  }
}
