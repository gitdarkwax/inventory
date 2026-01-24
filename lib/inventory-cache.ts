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

export interface CachedInventoryData {
  inventory: {
    totalSKUs: number;
    totalUnits: number;
    lowStockCount: number;
    outOfStockCount: number;
    locations: string[];
    inventory: InventoryByLocation[];
    locationDetails: Record<string, LocationDetail[]>;
  };
  forecasting: {
    forecasting: ForecastingItem[];
  };
  purchaseOrders?: {
    purchaseOrders: PurchaseOrderItem[];
  };
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
   */
  async saveCache(data: Omit<CachedInventoryData, 'lastUpdated' | 'refreshedBy'>, refreshedBy?: string): Promise<void> {
    const cacheData: CachedInventoryData = {
      ...data,
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
}
