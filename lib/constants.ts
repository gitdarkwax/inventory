/**
 * Inventory-specific configuration constants
 */

export const TIMEZONE = 'America/Los_Angeles';

// Low stock thresholds by product category
export interface StockThreshold {
  category: string;
  threshold: number;
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

export const STOCK_THRESHOLDS: StockThreshold[] = [
  { category: 'iPhone', threshold: 20 },
  { category: 'Samsung', threshold: 15 },
  { category: 'Pixel', threshold: 10 },
  { category: 'Wallets', threshold: 25 },
  { category: 'Tesla Charger', threshold: 5 },
  { category: 'MultiCharger', threshold: 10 },
  { category: 'Car Charger', threshold: 10 },
  { category: 'RimCase', threshold: 15 },
  { category: 'Accessories', threshold: 30 },
];

/**
 * Product category definitions for inventory grouping
 */
export interface ProductCategory {
  name: string;
  match: RegExp;
  titleMatch?: RegExp;
}

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  {
    name: 'iPhone',
    match: /(^MBC1\d+|^EC\d+|^MBCX\d+)/
  },
  {
    name: 'Samsung',
    match: /(^MBS\d+|^ES\d+)/
  },
  {
    name: 'Pixel',
    match: /(^MBP\d+|^EP\d+)/
  },
  {
    name: 'Wallets',
    match: /(^MBWLT-|^LSR-WLT-|^FMWLT-)/
  },
  {
    name: 'Tesla Charger',
    match: /(^MBT)/
  },
  {
    name: 'MultiCharger',
    match: /(^MBQIML|^MBQISS)/,
    titleMatch: /multicharger/i
  },
  {
    name: 'Car Charger',
    match: /(^MBQI\-)/
  },
  {
    name: 'RimCase',
    match: /(^RPTM)/
  },
  {
    name: 'Accessories',
    match: /(^ACC|^LP|^ACS|^ACP|^ACU|^BTN|^WRT|^APD|^MBST|^SP|^MBKH)/
  }
];

/**
 * Find which product category a SKU belongs to
 */
export function findProductCategory(sku: string, productName?: string): ProductCategory | null {
  for (const category of PRODUCT_CATEGORIES) {
    // For MultiCharger: ONLY match by product title, ignore SKU
    if (category.name === 'MultiCharger') {
      if (category.titleMatch && productName && productName.match(category.titleMatch)) {
        return category;
      }
      continue;
    }
    
    // For all other categories: ONLY match by SKU pattern
    if (sku && sku.match(category.match)) {
      return category;
    }
  }
  return null;
}

/**
 * Get stock threshold for a SKU
 */
export function getStockThreshold(sku: string, productName?: string): number {
  const category = findProductCategory(sku, productName);
  if (!category) return DEFAULT_LOW_STOCK_THRESHOLD;
  
  const threshold = STOCK_THRESHOLDS.find(t => t.category === category.name);
  return threshold?.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
}
