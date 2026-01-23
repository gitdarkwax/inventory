'use client';

/**
 * Inventory Dashboard Component
 * Displays inventory levels and forecasting data
 */

import { useState, useEffect, useRef, Fragment } from 'react';
import { signOut } from 'next-auth/react';
import { PRODUCT_CATEGORIES, findProductCategory } from '@/lib/constants';

// Types
interface InventoryByLocation {
  sku: string;
  productTitle: string;
  variantTitle: string;
  locations: Record<string, number>;
  totalAvailable: number;
}

interface LocationDetail {
  sku: string;
  productTitle: string;
  variantTitle: string;
  available: number;
  onHand: number;
  committed: number;
  incoming: number;
}

interface InventorySummary {
  totalSKUs: number;
  totalUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  locations: string[];
  inventory: InventoryByLocation[];
  locationDetails: Record<string, LocationDetail[]>;
  lastUpdated: string;
}

interface ForecastingItem {
  sku: string;
  productName: string;
  avgDaily7d: number;
  avgDaily21d: number;
  avgDaily90d: number;
  avgDailyLastYear30d: number;
  totalInventory?: number;
  daysOfStock?: number;
}

interface ForecastingData {
  forecasting: ForecastingItem[];
  lastUpdated: string;
}

interface PurchaseOrderItem {
  sku: string;
  pendingQuantity: number;
}

interface PurchaseOrderData {
  purchaseOrders: PurchaseOrderItem[];
  lastUpdated?: string;
}

interface DashboardProps {
  session: {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  };
}

interface ProductionOrderItem {
  sku: string;
  quantity: number;
  receivedQuantity: number;
}

interface ProductionOrder {
  id: string;
  items: ProductionOrderItem[];
  notes: string;
  vendor?: string;
  eta?: string;
  status: 'in_production' | 'partial' | 'completed' | 'cancelled';
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
}

type TabType = 'inventory' | 'forecasting' | 'planning' | 'production';

export default function Dashboard({ session }: DashboardProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('inventory');
  
  // Inventory state
  const [inventoryData, setInventoryData] = useState<InventorySummary | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'sku' | 'total'>('sku');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [filterOutOfStock, setFilterOutOfStock] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [inventoryViewMode, setInventoryViewMode] = useState<'list' | 'grouped'>('grouped');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [locationSearchTerm, setLocationSearchTerm] = useState('');
  const [locationSortBy, setLocationSortBy] = useState<'sku' | 'onHand' | 'available' | 'committed' | 'incoming'>('sku');
  const [locationSortOrder, setLocationSortOrder] = useState<'asc' | 'desc'>('asc');
  const [locationViewMode, setLocationViewMode] = useState<'list' | 'grouped'>('grouped');

  // Forecasting state
  const [forecastingData, setForecastingData] = useState<ForecastingData | null>(null);
  const [forecastingLoading, setForecastingLoading] = useState(false);
  const [forecastingError, setForecastingError] = useState<string | null>(null);
  const [forecastSearchTerm, setForecastSearchTerm] = useState('');
  const [forecastSortBy, setForecastSortBy] = useState<'sku' | 'avgDaily7d' | 'avgDaily21d' | 'avgDaily90d' | 'avgDailyLastYear30d'>('avgDaily7d');
  const [forecastSortOrder, setForecastSortOrder] = useState<'asc' | 'desc'>('desc');
  const [forecastViewMode, setForecastViewMode] = useState<'velocity' | 'daysLeft' | 'runOut'>('velocity');
  const [forecastFilterCategory, setForecastFilterCategory] = useState<string>('all');
  const [forecastListMode, setForecastListMode] = useState<'list' | 'grouped'>('grouped');
  const [forecastLayout, setForecastLayout] = useState<'byPeriod' | 'byMetric'>('byPeriod');
  const [forecastSelectedPeriod, setForecastSelectedPeriod] = useState<'7d' | '21d' | '90d' | 'ly30d'>('21d');
  const [forecastLocations, setForecastLocations] = useState<string[]>(['all']);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const locationDropdownRef = useRef<HTMLDivElement>(null);

  // Planning state
  const [planningSearchTerm, setPlanningSearchTerm] = useState('');
  const [planningBurnPeriod, setPlanningBurnPeriod] = useState<'7d' | '21d' | '90d'>('21d');
  const [planningFilterCategory, setPlanningFilterCategory] = useState<string>('all');
  const [planningListMode, setPlanningListMode] = useState<'list' | 'grouped'>('list');
  const [planningSortBy, setPlanningSortBy] = useState<'sku' | 'la' | 'incoming' | 'china' | 'poQty' | 'unitsPerDay' | 'shipType'>('shipType');
  const [planningSortOrder, setPlanningSortOrder] = useState<'asc' | 'desc'>('asc');

  // Purchase Order state (from manual production orders)
  const [purchaseOrderData, setPurchaseOrderData] = useState<PurchaseOrderData | null>(null);

  // Production Orders state
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);
  const [productionOrdersLoading, setProductionOrdersLoading] = useState(false);
  const [showNewOrderForm, setShowNewOrderForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ProductionOrder | null>(null);
  const [newOrderItems, setNewOrderItems] = useState<{ sku: string; quantity: string }[]>([{ sku: '', quantity: '' }]);
  const [newOrderNotes, setNewOrderNotes] = useState('');
  const [newOrderVendor, setNewOrderVendor] = useState('');
  const [newOrderEta, setNewOrderEta] = useState('');
  const [productionFilterStatus, setProductionFilterStatus] = useState<'all' | 'open' | 'completed'>('open');
  const [skuSuggestionIndex, setSkuSuggestionIndex] = useState<number | null>(null);
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [deliveryItems, setDeliveryItems] = useState<{ sku: string; quantity: string }[]>([]);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editOrderItems, setEditOrderItems] = useState<{ sku: string; quantity: string }[]>([]);
  const [editOrderVendor, setEditOrderVendor] = useState('');
  const [editOrderEta, setEditOrderEta] = useState('');
  const [editOrderNotes, setEditOrderNotes] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load cached inventory data
  const loadInventoryFromCache = async () => {
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const response = await fetch('/api/inventory');
      const data = await response.json();
      if (!response.ok) {
        // No cache available - this is expected on first load
        if (response.status === 503) {
          setInventoryError('No cached data. Click Refresh to load data from Shopify.');
        } else {
          throw new Error(data.error || 'Failed to fetch inventory');
        }
        return;
      }
      setInventoryData(data);
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setInventoryLoading(false);
    }
  };

  // Load cached forecasting data
  const loadForecastingFromCache = async () => {
    setForecastingLoading(true);
    setForecastingError(null);
    try {
      const response = await fetch('/api/forecasting');
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 503) {
          setForecastingError('No cached data. Click Refresh to load data from Shopify.');
        } else {
          throw new Error(data.error || 'Failed to fetch forecasting data');
        }
        return;
      }
      setForecastingData(data);
    } catch (err) {
      setForecastingError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setForecastingLoading(false);
    }
  };

  // Load production orders
  const loadProductionOrders = async () => {
    setProductionOrdersLoading(true);
    try {
      const response = await fetch('/api/production-orders');
      const data = await response.json();
      if (response.ok) {
        setProductionOrders(data.orders || []);
        // Also update PO data for Planning tab
        const pendingResponse = await fetch('/api/production-orders/pending');
        const pendingData = await pendingResponse.json();
        if (pendingResponse.ok) {
          setPurchaseOrderData({
            purchaseOrders: pendingData.pendingBysku || [],
          });
        }
      }
    } catch (err) {
      console.error('Failed to load production orders:', err);
    } finally {
      setProductionOrdersLoading(false);
    }
  };

  // Create new production order
  const createProductionOrder = async () => {
    const validItems = newOrderItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ sku: item.sku.trim().toUpperCase(), quantity: parseInt(item.quantity) }));

    if (validItems.length === 0) {
      alert('Please add at least one item with a valid SKU and quantity');
      return;
    }

    try {
      const response = await fetch('/api/production-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          items: validItems, 
          notes: newOrderNotes,
          vendor: newOrderVendor || undefined,
          eta: newOrderEta || undefined,
        }),
      });

      if (response.ok) {
        setShowNewOrderForm(false);
        setNewOrderItems([{ sku: '', quantity: '' }]);
        setNewOrderNotes('');
        setNewOrderVendor('');
        setNewOrderEta('');
        await loadProductionOrders();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to create order');
      }
    } catch (err) {
      alert('Failed to create order');
    }
  };

  // Update production order status
  const updateOrderStatus = async (orderId: string, status: ProductionOrder['status']) => {
    try {
      const response = await fetch('/api/production-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status }),
      });

      if (response.ok) {
        await loadProductionOrders();
        setSelectedOrder(null);
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to update order');
      }
    } catch (err) {
      alert('Failed to update order');
    }
  };

  // Log delivery for production order
  const logDelivery = async (orderId: string) => {
    const validDeliveries = deliveryItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ sku: item.sku.trim().toUpperCase(), quantity: parseInt(item.quantity) }));

    if (validDeliveries.length === 0) {
      alert('Please enter at least one delivery quantity');
      return;
    }

    try {
      const response = await fetch('/api/production-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, deliveries: validDeliveries }),
      });

      if (response.ok) {
        const data = await response.json();
        setShowDeliveryForm(false);
        setDeliveryItems([]);
        setSelectedOrder(data.order);
        await loadProductionOrders();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to log delivery');
      }
    } catch (err) {
      alert('Failed to log delivery');
    }
  };

  // Save edited production order
  const saveEditOrder = async (orderId: string) => {
    const validItems = editOrderItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ sku: item.sku.trim().toUpperCase(), quantity: parseInt(item.quantity) }));

    if (validItems.length === 0) {
      alert('Please add at least one item with a valid SKU and quantity');
      return;
    }

    try {
      const response = await fetch('/api/production-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          items: validItems,
          vendor: editOrderVendor || undefined,
          eta: editOrderEta || undefined,
          notes: editOrderNotes,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setShowEditForm(false);
        setSelectedOrder(data.order);
        await loadProductionOrders();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to update order');
      }
    } catch (err) {
      alert('Failed to update order');
    }
  };

  // Cancel production order
  const cancelOrder = async (orderId: string) => {
    try {
      const response = await fetch('/api/production-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status: 'cancelled' }),
      });

      if (response.ok) {
        setShowCancelConfirm(false);
        setSelectedOrder(null);
        await loadProductionOrders();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to cancel order');
      }
    } catch (err) {
      alert('Failed to cancel order');
    }
  };

  // Refresh all data from Shopify (called when user clicks Refresh button)
  const refreshAllData = async () => {
    setIsRefreshing(true);
    setInventoryError(null);
    setForecastingError(null);
    try {
      const response = await fetch('/api/refresh');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Refresh failed');
      }
      // Reload both caches after successful refresh
      await Promise.all([loadInventoryFromCache(), loadForecastingFromCache()]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Refresh failed';
      setInventoryError(errorMsg);
      setForecastingError(errorMsg);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Load data when tab changes
  useEffect(() => {
    if (activeTab === 'inventory' && !inventoryData && !inventoryLoading) {
      loadInventoryFromCache();
    } else if (activeTab === 'forecasting' && !forecastingData && !forecastingLoading) {
      loadForecastingFromCache();
    } else if (activeTab === 'planning') {
      // Planning tab needs both inventory and forecasting data
      if (!inventoryData && !inventoryLoading) loadInventoryFromCache();
      if (!forecastingData && !forecastingLoading) loadForecastingFromCache();
      if (productionOrders.length === 0 && !productionOrdersLoading) loadProductionOrders();
    } else if (activeTab === 'production') {
      if (productionOrders.length === 0 && !productionOrdersLoading) loadProductionOrders();
    }
  }, [activeTab]);

  // Initial load from cache
  useEffect(() => {
    loadInventoryFromCache();
    loadProductionOrders(); // Also load PO data for Planning tab
  }, []);

  // Close location dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (locationDropdownRef.current && !locationDropdownRef.current.contains(event.target as Node)) {
        setShowLocationDropdown(false);
      }
    };
    if (showLocationDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLocationDropdown]);

  // Helper to calculate inventory for selected locations
  const getInventoryForLocations = (inventoryItem: InventoryByLocation | undefined, selectedLocations: string[]): number => {
    if (!inventoryItem) return 0;
    if (selectedLocations.includes('all')) return inventoryItem.totalAvailable;
    return selectedLocations.reduce((sum, loc) => sum + (inventoryItem.locations[loc] || 0), 0);
  };

  // Toggle location selection
  const toggleForecastLocation = (location: string) => {
    if (location === 'all') {
      setForecastLocations(['all']);
    } else {
      let newLocations = forecastLocations.filter(l => l !== 'all');
      if (newLocations.includes(location)) {
        newLocations = newLocations.filter(l => l !== location);
        if (newLocations.length === 0) newLocations = ['all'];
      } else {
        newLocations.push(location);
      }
      setForecastLocations(newLocations);
    }
  };

  // Get location label for dropdown button
  const getForecastLocationLabel = (): string => {
    if (forecastLocations.includes('all')) return 'All Locations';
    if (forecastLocations.length === 1) return forecastLocations[0];
    return `${forecastLocations.length} Locations`;
  };

  // Merge forecasting with inventory for days of stock calculation
  const mergedForecastingData = forecastingData?.forecasting.map(item => {
    const inventoryItem = inventoryData?.inventory.find(inv => inv.sku === item.sku);
    const totalInventory = getInventoryForLocations(inventoryItem, forecastLocations);
    const avgDaily = item.avgDaily21d; // Use 21-day average for days of stock
    const daysOfStock = avgDaily > 0 ? totalInventory / avgDaily : totalInventory > 0 ? 999 : 0;
    return {
      ...item,
      totalInventory,
      daysOfStock,
      locationInventory: inventoryItem?.locations || {},
    };
  }) || [];

  // Filter and sort inventory
  const filteredInventory = inventoryData?.inventory
    .filter(item => {
      const matchesSearch = !searchTerm || 
        item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.productTitle.toLowerCase().includes(searchTerm.toLowerCase());
      if (filterOutOfStock && item.totalAvailable > 0) return false;
      if (filterLowStock && (item.totalAvailable <= 0 || item.totalAvailable > 10)) return false;
      if (filterCategory !== 'all') {
        const category = findProductCategory(item.sku, item.productTitle);
        if (!category || category.name !== filterCategory) return false;
      }
      return matchesSearch;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'sku') comparison = a.sku.localeCompare(b.sku);
      else if (sortBy === 'total') comparison = a.totalAvailable - b.totalAvailable;
      return sortOrder === 'asc' ? comparison : -comparison;
    }) || [];

  // Filter and sort location detail
  const filteredLocationDetail = selectedLocation && inventoryData?.locationDetails?.[selectedLocation]
    ? inventoryData.locationDetails[selectedLocation]
        .filter(item => {
          const matchesSearch = !locationSearchTerm || 
            item.sku.toLowerCase().includes(locationSearchTerm.toLowerCase()) ||
            item.productTitle.toLowerCase().includes(locationSearchTerm.toLowerCase());
          if (filterOutOfStock && item.available > 0) return false;
          if (filterLowStock && (item.available <= 0 || item.available > 10)) return false;
          if (filterCategory !== 'all') {
            const category = findProductCategory(item.sku, item.productTitle);
            if (!category || category.name !== filterCategory) return false;
          }
          return matchesSearch;
        })
        .sort((a, b) => {
          let comparison = 0;
          if (locationSortBy === 'sku') comparison = a.sku.localeCompare(b.sku);
          else comparison = a[locationSortBy] - b[locationSortBy];
          return locationSortOrder === 'asc' ? comparison : -comparison;
        })
    : [];

  // Filter and sort forecasting
  // Build a set of valid SKUs from inventory (products tagged "inventoried")
  const inventoriedSkus = new Set(inventoryData?.inventory.map(item => item.sku) || []);

  const filteredForecasting = mergedForecastingData
    .filter(item => {
      // Only show SKUs that exist in inventory (products tagged "inventoried")
      if (!inventoriedSkus.has(item.sku)) return false;
      
      const matchesSearch = !forecastSearchTerm || 
        item.sku.toLowerCase().includes(forecastSearchTerm.toLowerCase()) ||
        item.productName.toLowerCase().includes(forecastSearchTerm.toLowerCase());
      if (forecastFilterCategory !== 'all') {
        const category = findProductCategory(item.sku, item.productName);
        if (!category || category.name !== forecastFilterCategory) return false;
      }
      return matchesSearch;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (forecastSortBy === 'sku') comparison = a.sku.localeCompare(b.sku);
      else comparison = (a[forecastSortBy] || 0) - (b[forecastSortBy] || 0);
      return forecastSortOrder === 'asc' ? comparison : -comparison;
    });

  const handleSort = (column: 'sku' | 'total') => {
    if (sortBy === column) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortBy(column); setSortOrder('asc'); }
  };

  const handleLocationSort = (column: typeof locationSortBy) => {
    if (locationSortBy === column) setLocationSortOrder(locationSortOrder === 'asc' ? 'desc' : 'asc');
    else { setLocationSortBy(column); setLocationSortOrder('asc'); }
  };

  const handleForecastSort = (column: typeof forecastSortBy) => {
    if (forecastSortBy === column) setForecastSortOrder(forecastSortOrder === 'asc' ? 'desc' : 'asc');
    else { setForecastSortBy(column); setForecastSortOrder(forecastViewMode === 'velocity' ? 'desc' : 'asc'); }
  };

  // Calculate days of stock for a given velocity
  const calcDaysOfStock = (inventory: number, avgDaily: number): number => {
    if (avgDaily <= 0) return inventory > 0 ? 999 : 0;
    return inventory / avgDaily;
  };

  // Format days of stock display
  const formatDaysOfStock = (days: number): string => {
    if (days >= 999) return '∞';
    if (days <= 0) return '0';
    return Math.round(days).toString();
  };

  // Calculate and format run out date
  const formatRunOutDate = (days: number): string => {
    if (days >= 999) return '—'; // Infinite/no sales
    if (days <= 0) return 'Now'; // Already out
    const runOutDate = new Date();
    runOutDate.setDate(runOutDate.getDate() + Math.round(days));
    const month = runOutDate.toLocaleDateString('en-US', { month: 'short' });
    const day = runOutDate.getDate();
    const year = runOutDate.getFullYear().toString().slice(-2);
    return `${month} ${day}, ${year}`;
  };

  // Get color class for days of stock
  const getDaysColor = (days: number): string => {
    if (days <= 0) return 'text-red-600 font-medium';
    if (days <= 14) return 'text-red-600';
    if (days <= 30) return 'text-orange-600';
    if (days >= 999) return 'text-gray-400';
    return 'text-green-600';
  };

  // Check if SKU is a phone case (vs accessory like screen protector)
  const isPhoneCaseSku = (sku: string): boolean => {
    // Phone case SKUs start with: EC, ES, MBC, MBS, MBP, MBCX, EP
    return /^(EC|ES|MBC|MBS|MBP|MBCX|EP)\d/i.test(sku);
  };

  // Extract product model from SKU for grouping (SKU is the source of truth)
  const extractProductModel = (productTitle: string, sku: string): string => {
    const skuUpper = sku.toUpperCase();
    
    // Screen Protectors (SP, SC prefix)
    if (/^(SP|SC)/i.test(skuUpper)) {
      return 'Screen Protectors';
    }
    
    // Lens Protectors (LP prefix)
    if (/^LP/i.test(skuUpper)) {
      return 'Lens Protectors';
    }

    // iPhone case SKUs: EC17M, EC17P, EC17, MBC17M, MBC17P, MBC17, MBCX17M, etc.
    // Pattern: (EC|MBC|MBCX) + model number + optional variant (M=Max, P=Pro, PL=Plus, MN=Mini)
    const iphoneCaseMatch = skuUpper.match(/^(EC|MBC|MBCX)(\d+)(M|P|PL|MN)?/);
    if (iphoneCaseMatch) {
      const model = iphoneCaseMatch[2];
      const variant = iphoneCaseMatch[3];
      if (variant === 'M') return `iPhone ${model} Pro Max`;
      if (variant === 'P') return `iPhone ${model} Pro`;
      if (variant === 'PL') return `iPhone ${model} Plus`;
      if (variant === 'MN') return `iPhone ${model} mini`;
      return `iPhone ${model}`;
    }

    // Samsung Galaxy S26 (ES26 prefix)
    if (/^ES26/i.test(skuUpper)) {
      return 'Samsung Galaxy S26';
    }

    // Samsung Galaxy S25 (ES25, MBS25 prefix)
    if (/^(ES25|MBS25)/i.test(skuUpper)) {
      return 'Samsung Galaxy S25';
    }

    // Samsung Galaxy S24 (ES24, MBS24 prefix)
    if (/^(ES24|MBS24)/i.test(skuUpper)) {
      return 'Samsung Galaxy S24';
    }

    // Pixel Cases (EP, MBP prefix)
    if (/^(EP|MBP)\d/i.test(skuUpper)) {
      return 'Pixel Cases';
    }

    // Wrist Straps (WRT prefix)
    if (/^WRT/i.test(skuUpper)) {
      return 'Wrist Straps';
    }

    // Wallets (FMWLT, MBWLT prefix)
    if (/^(FMWLT|MBWLT)/i.test(skuUpper)) {
      return 'Wallets';
    }

    // Color Accessories (ACC, ACU, ACP, LF, ACS, BTN prefix)
    if (/^(ACC|ACU|ACP|LF|ACS|BTN)/i.test(skuUpper)) {
      return 'Color Accessories';
    }

    // KeyTag (MBKH prefix)
    if (/^MBKH/i.test(skuUpper)) {
      return 'KeyTag';
    }

    // Tesla Charger (MBT prefix)
    if (/^MBT/i.test(skuUpper)) {
      return 'Tesla Charger';
    }

    // Chargers (MBQI, TVL, MBPD prefix)
    if (/^(MBQI|TVL|MBPD)/i.test(skuUpper)) {
      return 'Chargers';
    }

    // MagSticks (MBST prefix)
    if (/^MBST/i.test(skuUpper)) {
      return 'MagSticks';
    }

    // RimCase (RPTM prefix)
    if (/^RPTM/i.test(skuUpper)) {
      return 'RimCase';
    }

    // For other products, use a simplified title (first 30 chars or up to first dash/pipe)
    const simplified = productTitle.split(/[-|]/)[0].trim();
    return simplified.length > 40 ? simplified.substring(0, 40) + '...' : simplified;
  };

  // Group inventory items by product model
  const groupedInventory = filteredInventory.reduce((groups, item) => {
    const model = extractProductModel(item.productTitle, item.sku);
    if (!groups[model]) {
      groups[model] = [];
    }
    groups[model].push(item);
    return groups;
  }, {} as Record<string, typeof filteredInventory>);

  // Get model number for sorting (higher = newer = more revenue)
  const getModelPriority = (groupName: string): number => {
    // iPhone - extract number, multiply by 1000 for priority
    const iphoneMatch = groupName.match(/iPhone (\d+)/);
    if (iphoneMatch) {
      const base = parseInt(iphoneMatch[1]) * 1000;
      // Pro Max > Pro > Plus > base > mini
      if (groupName.includes('Pro Max')) return base + 4;
      if (groupName.includes('Pro')) return base + 3;
      if (groupName.includes('Plus')) return base + 2;
      if (groupName.includes('mini')) return base;
      return base + 1;
    }
    
    // Samsung Galaxy S series
    const samsungMatch = groupName.match(/Galaxy S(\d+)/);
    if (samsungMatch) {
      const base = parseInt(samsungMatch[1]) * 100;
      if (groupName.includes('Ultra')) return base + 3;
      if (groupName.includes('+') || groupName.includes('Plus')) return base + 2;
      if (groupName.includes('FE')) return base;
      return base + 1;
    }
    
    // Samsung Galaxy Z Fold/Flip
    const zFoldMatch = groupName.match(/Z Fold (\d+)/i);
    if (zFoldMatch) return parseInt(zFoldMatch[1]) * 50 + 500;
    const zFlipMatch = groupName.match(/Z Flip (\d+)/i);
    if (zFlipMatch) return parseInt(zFlipMatch[1]) * 50 + 400;
    
    // Pixel Cases (after Samsung)
    if (groupName === 'Pixel Cases') return 50;
    
    // Accessories - ordered by priority
    if (groupName === 'Wallets') return -10;
    if (groupName === 'RimCase') return -15;
    if (groupName === 'Wrist Straps') return -20;
    if (groupName === 'KeyTag') return -30;
    if (groupName === 'MagSticks') return -35;
    if (groupName === 'Tesla Charger') return -40;
    if (groupName === 'Chargers') return -50;
    if (groupName === 'Color Accessories') return -60;
    if (groupName === 'Screen Protectors') return -70;
    if (groupName === 'Lens Protectors') return -80;
    
    // Other products - at the end
    return -100;
  };

  // Sort group names by revenue priority (higher priority = first)
  const sortedGroupNames = Object.keys(groupedInventory).sort((a, b) => {
    return getModelPriority(b) - getModelPriority(a);
  });

  // Group location detail items by product model
  const groupedLocationDetail = filteredLocationDetail.reduce((groups, item) => {
    const model = extractProductModel(item.productTitle, item.sku);
    if (!groups[model]) {
      groups[model] = [];
    }
    groups[model].push(item);
    return groups;
  }, {} as Record<string, typeof filteredLocationDetail>);

  const sortedLocationGroupNames = Object.keys(groupedLocationDetail).sort((a, b) => {
    return getModelPriority(b) - getModelPriority(a);
  });

  // Group forecasting items by product model
  const groupedForecasting = filteredForecasting.reduce((groups, item) => {
    const model = extractProductModel(item.productName, item.sku);
    if (!groups[model]) {
      groups[model] = [];
    }
    groups[model].push(item);
    return groups;
  }, {} as Record<string, typeof filteredForecasting>);

  const sortedForecastGroupNames = Object.keys(groupedForecasting).sort((a, b) => {
    return getModelPriority(b) - getModelPriority(a);
  });

  const SortIcon = ({ active, order }: { active: boolean; order: 'asc' | 'desc' }) => {
    if (!active) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="ml-1">{order === 'asc' ? '↑' : '↓'}</span>;
  };

  // Location Detail View
  if (selectedLocation && inventoryData) {
    const locationData = filteredLocationDetail;
    const totalOnHand = locationData.reduce((sum, item) => sum + item.onHand, 0);
    const totalAvailable = locationData.reduce((sum, item) => sum + item.available, 0);
    const totalCommitted = locationData.reduce((sum, item) => sum + item.committed, 0);
    const totalIncoming = locationData.reduce((sum, item) => sum + item.incoming, 0);

    return (
      <div className="min-h-screen bg-gray-50 py-4 sm:py-8">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
          <div className="bg-white shadow rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <button onClick={() => { setSelectedLocation(null); setLocationSearchTerm(''); }} className="text-blue-600 hover:text-blue-800">← Back</button>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">📍 {selectedLocation}</h1>
              </div>
              {session?.user && (
                <div className="flex items-center gap-3 mt-2 sm:mt-0">
                  <span className="text-sm text-gray-500">{session.user.email}</span>
                  <button onClick={() => signOut()} className="text-xs px-3 py-1 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">Sign Out</button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="text-center bg-white shadow rounded-lg p-3 sm:p-4">
              <p className="text-xs sm:text-sm font-medium text-gray-500">On Hand</p>
              <p className="text-lg sm:text-xl font-bold text-blue-600">{totalOnHand.toLocaleString()}</p>
            </div>
            <div className="text-center bg-white shadow rounded-lg p-3 sm:p-4">
              <p className="text-xs sm:text-sm font-medium text-gray-500">Available</p>
              <p className="text-lg sm:text-xl font-bold text-green-600">{totalAvailable.toLocaleString()}</p>
            </div>
            <div className="text-center bg-white shadow rounded-lg p-3 sm:p-4">
              <p className="text-xs sm:text-sm font-medium text-gray-500">Committed</p>
              <p className="text-lg sm:text-xl font-bold text-orange-600">{totalCommitted.toLocaleString()}</p>
            </div>
            <div className="text-center bg-white shadow rounded-lg p-3 sm:p-4">
              <p className="text-xs sm:text-sm font-medium text-gray-500">Incoming</p>
              <p className="text-lg sm:text-xl font-bold text-purple-600">{totalIncoming.toLocaleString()}</p>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div className="flex gap-2 flex-wrap items-center">
                <select 
                  value={filterCategory} 
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="px-3 py-2 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Categories</option>
                  {PRODUCT_CATEGORIES.map(cat => (
                    <option key={cat.name} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  <button onClick={() => setLocationViewMode('list')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${locationViewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    List
                  </button>
                  <button onClick={() => setLocationViewMode('grouped')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${locationViewMode === 'grouped' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    Grouped
                  </button>
                </div>
                <button onClick={() => { setFilterLowStock(!filterLowStock); setFilterOutOfStock(false); }}
                  className={`px-3 py-2 text-xs font-medium rounded-md ${filterLowStock ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Low Stock
                </button>
                <button onClick={() => { setFilterOutOfStock(!filterOutOfStock); setFilterLowStock(false); }}
                  className={`px-3 py-2 text-xs font-medium rounded-md ${filterOutOfStock ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Out of Stock
                </button>
              </div>
              <input type="text" placeholder="Search by SKU or product..." value={locationSearchTerm} onChange={(e) => setLocationSearchTerm(e.target.value)}
                className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* List View */}
          {locationViewMode === 'list' && (
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 table-fixed">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-32 px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('sku')}>
                        SKU <SortIcon active={locationSortBy === 'sku'} order={locationSortOrder} />
                      </th>
                      <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('onHand')}>
                        On Hand <SortIcon active={locationSortBy === 'onHand'} order={locationSortOrder} />
                      </th>
                      <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('available')}>
                        Available <SortIcon active={locationSortBy === 'available'} order={locationSortOrder} />
                      </th>
                      <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('committed')}>
                        Committed <SortIcon active={locationSortBy === 'committed'} order={locationSortOrder} />
                      </th>
                      <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('incoming')}>
                        Incoming <SortIcon active={locationSortBy === 'incoming'} order={locationSortOrder} />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {locationData.map((item, index) => (
                      <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="w-32 px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={`${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`}>{item.sku}</td>
                        <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.onHand.toLocaleString()}</td>
                        <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${item.available <= 0 ? 'text-red-600 font-medium' : item.available <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>{item.available.toLocaleString()}</td>
                        <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.committed.toLocaleString()}</td>
                        <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${item.incoming > 0 ? 'text-purple-600 font-medium' : 'text-gray-900'}`}>{item.incoming.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {locationData.length === 0 && <div className="p-8 text-center text-gray-500">No inventory items match your filters.</div>}
            </div>
          )}

          {/* Grouped View */}
          {locationViewMode === 'grouped' && (
            <div className="space-y-4">
              {sortedLocationGroupNames.length === 0 && (
                <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">No inventory items match your filters.</div>
              )}
              {sortedLocationGroupNames.map(groupName => {
                // Sort items - reverse alphabetical for Screen/Lens Protectors, otherwise alphabetical
                const shouldReverseSort = groupName === 'Screen Protectors' || groupName === 'Lens Protectors';
                const items = [...groupedLocationDetail[groupName]].sort((a, b) => 
                  shouldReverseSort ? b.sku.localeCompare(a.sku) : a.sku.localeCompare(b.sku)
                );
                const groupAvailable = items.reduce((sum, item) => sum + item.available, 0);
                return (
                  <div key={groupName} className="bg-white shadow rounded-lg overflow-hidden">
                    <div className="bg-gray-100 px-4 py-3 border-b border-gray-200">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-semibold text-gray-900">{groupName}</h3>
                        <div className="flex gap-4 text-xs text-gray-500">
                          <span>{items.length} SKUs</span>
                          <span className="font-medium text-gray-700">{groupAvailable.toLocaleString()} available</span>
                        </div>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 table-fixed">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-32 px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                            <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">On Hand</th>
                            <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Available</th>
                            <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Committed</th>
                            <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Incoming</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {items.map((item, index) => (
                            <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="w-32 px-3 sm:px-4 py-2 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={`${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`}>{item.sku}</td>
                              <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{item.onHand.toLocaleString()}</td>
                              <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.available <= 0 ? 'text-red-600 font-medium' : item.available <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>{item.available.toLocaleString()}</td>
                              <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{item.committed.toLocaleString()}</td>
                              <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.incoming > 0 ? 'text-purple-600 font-medium' : 'text-gray-900'}`}>{item.incoming.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main Dashboard View
  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-8">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
        {/* Header */}
        <div className="bg-white shadow rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-4">
            <div className="flex-1">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">📦 MagBak Inventory Dashboard</h1>
              <p className="text-sm text-gray-500 mt-1">Real-time stock levels and forecasting</p>
              {inventoryData?.lastUpdated && (
                <p className="text-xs text-gray-400 mt-1">
                  Last refreshed: {new Date(inventoryData.lastUpdated).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                  })}
                </p>
              )}
            </div>
            {session?.user && (
              <div className="flex items-center gap-3 mt-2 sm:mt-0">
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{session.user.name}</p>
                  <p className="text-xs text-gray-500">{session.user.email}</p>
                </div>
                {session.user.image && <img src={session.user.image} alt="Profile" className="h-8 w-8 rounded-full" />}
                <button onClick={() => signOut()} className="text-xs px-3 py-1 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">Sign Out</button>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit">
            <button
              onClick={() => setActiveTab('inventory')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'inventory' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
              }`}
            >
              📦 Inventory
            </button>
            <button
              onClick={() => setActiveTab('forecasting')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'forecasting' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
              }`}
            >
              📈 Forecasting
            </button>
            <button
              onClick={() => setActiveTab('planning')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'planning' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
              }`}
            >
              📋 Planning
            </button>
            <button
              onClick={() => setActiveTab('production')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'production' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
              }`}
            >
              🏭 Production
            </button>
          </div>
        </div>

        {/* Inventory Tab */}
        {activeTab === 'inventory' && (
          <>
            {inventoryLoading && (
              <div className="bg-white rounded-lg shadow-md p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading inventory data...</p>
              </div>
            )}

            {inventoryError && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-4 text-center">
                <p className="text-sm text-yellow-800 mb-4">{inventoryError}</p>
                <button onClick={refreshAllData} disabled={isRefreshing}
                  className={`px-4 py-2 text-sm font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                  {isRefreshing ? '⏳ Loading data from Shopify...' : '🔄 Refresh Data'}
                </button>
              </div>
            )}

            {!inventoryLoading && inventoryData && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <div className="text-center bg-white shadow rounded-lg p-3 sm:p-4">
                    <p className="text-xs sm:text-sm font-medium text-gray-500">Total SKUs</p>
                    <p className="text-lg sm:text-xl font-bold text-blue-600">{inventoryData.totalSKUs.toLocaleString()}</p>
                  </div>
                  <div className="text-center bg-white shadow rounded-lg p-3 sm:p-4">
                    <p className="text-xs sm:text-sm font-medium text-gray-500">Total Units</p>
                    <p className="text-lg sm:text-xl font-bold text-green-600">{inventoryData.totalUnits.toLocaleString()}</p>
                  </div>
                  <div className="text-center bg-white shadow rounded-lg p-3 sm:p-4">
                    <p className="text-xs sm:text-sm font-medium text-gray-500">Low Stock</p>
                    <p className="text-lg sm:text-xl font-bold text-orange-600">{inventoryData.lowStockCount.toLocaleString()}</p>
                  </div>
                  <div className="text-center bg-white shadow rounded-lg p-3 sm:p-4">
                    <p className="text-xs sm:text-sm font-medium text-gray-500">Out of Stock</p>
                    <p className="text-lg sm:text-xl font-bold text-red-600">{inventoryData.outOfStockCount.toLocaleString()}</p>
                  </div>
                </div>

                <div className="bg-white shadow rounded-lg p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                    <div className="flex gap-2 flex-wrap items-center">
                      <select 
                        value={filterCategory} 
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="px-3 py-2 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="all">All Categories</option>
                        {PRODUCT_CATEGORIES.map(cat => (
                          <option key={cat.name} value={cat.name}>{cat.name}</option>
                        ))}
                      </select>
                      {/* View Mode Toggle */}
                      <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button
                          onClick={() => setInventoryViewMode('list')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            inventoryViewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          List
                        </button>
                        <button
                          onClick={() => setInventoryViewMode('grouped')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            inventoryViewMode === 'grouped' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          Grouped
                        </button>
                      </div>
                      <button onClick={() => { setFilterLowStock(!filterLowStock); setFilterOutOfStock(false); }}
                        className={`px-3 py-2 text-xs font-medium rounded-md ${filterLowStock ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        Low Stock ({inventoryData.lowStockCount})
                      </button>
                      <button onClick={() => { setFilterOutOfStock(!filterOutOfStock); setFilterLowStock(false); }}
                        className={`px-3 py-2 text-xs font-medium rounded-md ${filterOutOfStock ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        Out of Stock ({inventoryData.outOfStockCount})
                      </button>
                      <button onClick={refreshAllData} disabled={isRefreshing}
                        className={`px-3 py-2 text-xs font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                        {isRefreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
                      </button>
                    </div>
                    <input type="text" placeholder="Search by SKU or product..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                {/* List View */}
                {inventoryViewMode === 'list' && (
                  <div className="bg-white shadow rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 table-fixed">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-32 px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('sku')}>
                              SKU <SortIcon active={sortBy === 'sku'} order={sortOrder} />
                            </th>
                            {inventoryData.locations.map(location => (
                              <th key={location} className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 hover:text-blue-600"
                                onClick={() => setSelectedLocation(location)} title={`Click to view ${location} details`}>
                                {location} →
                              </th>
                            ))}
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('total')}>
                              Total <SortIcon active={sortBy === 'total'} order={sortOrder} />
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {filteredInventory.map((item, index) => (
                            <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="w-32 px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis"
                                title={`${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`}>{item.sku}</td>
                              {inventoryData.locations.map(location => {
                                const qty = item.locations?.[location] ?? 0;
                                return (
                                  <td key={location} className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${qty <= 0 ? 'text-red-600 font-medium' : qty <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                                    {qty.toLocaleString()}
                                  </td>
                                );
                              })}
                              <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center font-medium ${item.totalAvailable <= 0 ? 'text-red-600' : item.totalAvailable <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                                {item.totalAvailable.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {filteredInventory.length === 0 && <div className="p-8 text-center text-gray-500">No inventory items match your filters.</div>}
                  </div>
                )}

                {/* Grouped View */}
                {inventoryViewMode === 'grouped' && (
                  <div className="space-y-4">
                    {sortedGroupNames.length === 0 && (
                      <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">No inventory items match your filters.</div>
                    )}
                    {sortedGroupNames.map(groupName => {
                      // Sort items - reverse alphabetical for Screen/Lens Protectors, otherwise alphabetical
                      const shouldReverseSort = groupName === 'Screen Protectors' || groupName === 'Lens Protectors';
                      const items = [...groupedInventory[groupName]].sort((a, b) => 
                        shouldReverseSort ? b.sku.localeCompare(a.sku) : a.sku.localeCompare(b.sku)
                      );
                      const groupTotal = items.reduce((sum, item) => sum + item.totalAvailable, 0);
                      return (
                        <div key={groupName} className="bg-white shadow rounded-lg overflow-hidden">
                          <div className="bg-gray-100 px-4 py-3 border-b border-gray-200">
                            <div className="flex justify-between items-center">
                              <h3 className="text-sm font-semibold text-gray-900">{groupName}</h3>
                              <div className="flex gap-4 text-xs text-gray-500">
                                <span>{items.length} SKUs</span>
                                <span className="font-medium text-gray-700">{groupTotal.toLocaleString()} units</span>
                              </div>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 table-fixed">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="w-32 px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                                  {inventoryData.locations.map(location => (
                                    <th key={location} className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 hover:text-blue-600"
                                      onClick={() => setSelectedLocation(location)} title={`Click to view ${location} details`}>
                                      {location} →
                                    </th>
                                  ))}
                                  <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {items.map((item, index) => (
                                  <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    <td className="w-32 px-3 sm:px-4 py-2 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis"
                                      title={`${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`}>{item.sku}</td>
                                    {inventoryData.locations.map(location => {
                                      const qty = item.locations?.[location] ?? 0;
                                      return (
                                        <td key={location} className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${qty <= 0 ? 'text-red-600 font-medium' : qty <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                                          {qty.toLocaleString()}
                                        </td>
                                      );
                                    })}
                                    <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center font-medium ${item.totalAvailable <= 0 ? 'text-red-600' : item.totalAvailable <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                                      {item.totalAvailable.toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Forecasting Tab */}
        {activeTab === 'forecasting' && (
          <>
            {forecastingLoading && (
              <div className="bg-white rounded-lg shadow-md p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading forecasting data...</p>
              </div>
            )}

            {forecastingError && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-4 text-center">
                <p className="text-sm text-yellow-800 mb-4">{forecastingError}</p>
                <button onClick={refreshAllData} disabled={isRefreshing}
                  className={`px-4 py-2 text-sm font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                  {isRefreshing ? '⏳ Loading data from Shopify...' : '🔄 Refresh Data'}
                </button>
              </div>
            )}

            {!forecastingLoading && forecastingData && (
              <div className="space-y-6">
                <div className="bg-white shadow rounded-lg p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                    <div className="flex gap-2 flex-wrap items-center">
                      <select 
                        value={forecastFilterCategory} 
                        onChange={(e) => setForecastFilterCategory(e.target.value)}
                        className="px-3 py-2 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="all">All Categories</option>
                        {PRODUCT_CATEGORIES.map(cat => (
                          <option key={cat.name} value={cat.name}>{cat.name}</option>
                        ))}
                      </select>
                      {/* Location Multi-Select */}
                      <div className="relative" ref={locationDropdownRef}>
                        <button
                          onClick={() => setShowLocationDropdown(!showLocationDropdown)}
                          className="px-3 py-2 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center gap-1"
                        >
                          📍 {getForecastLocationLabel()}
                          <span className="text-gray-400">▼</span>
                        </button>
                        {showLocationDropdown && (
                          <div className="absolute z-10 mt-1 w-48 bg-white border border-gray-300 rounded-md shadow-lg">
                            <div className="py-1">
                              <button
                                onClick={() => { toggleForecastLocation('all'); setShowLocationDropdown(false); }}
                                className={`w-full px-3 py-2 text-left text-xs hover:bg-gray-100 flex items-center gap-2 ${forecastLocations.includes('all') ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                              >
                                {forecastLocations.includes('all') && <span>✓</span>}
                                <span className={forecastLocations.includes('all') ? '' : 'ml-5'}>All Locations</span>
                              </button>
                              <div className="border-t border-gray-200 my-1"></div>
                              {inventoryData?.locations.map(location => (
                                <button
                                  key={location}
                                  onClick={() => toggleForecastLocation(location)}
                                  className={`w-full px-3 py-2 text-left text-xs hover:bg-gray-100 flex items-center gap-2 ${forecastLocations.includes(location) ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                                >
                                  {forecastLocations.includes(location) && <span>✓</span>}
                                  <span className={forecastLocations.includes(location) ? '' : 'ml-5'}>{location}</span>
                                </button>
                              ))}
                            </div>
                            <div className="border-t border-gray-200 px-3 py-2">
                              <button
                                onClick={() => setShowLocationDropdown(false)}
                                className="w-full text-xs text-blue-600 hover:text-blue-800 font-medium"
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      {/* List/Grouped Toggle */}
                      <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button onClick={() => setForecastListMode('list')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${forecastListMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                          List
                        </button>
                        <button onClick={() => setForecastListMode('grouped')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${forecastListMode === 'grouped' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                          Grouped
                        </button>
                      </div>
                      {/* Layout Toggle: By Period vs By Metric */}
                      <div className="flex bg-blue-100 p-1 rounded-lg">
                        <button
                          onClick={() => setForecastLayout('byPeriod')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            forecastLayout === 'byPeriod' ? 'bg-white shadow-sm text-blue-700' : 'text-blue-600 hover:text-blue-800'
                          }`}
                        >
                          By Period
                        </button>
                        <button
                          onClick={() => setForecastLayout('byMetric')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            forecastLayout === 'byMetric' ? 'bg-white shadow-sm text-blue-700' : 'text-blue-600 hover:text-blue-800'
                          }`}
                        >
                          By Metric
                        </button>
                      </div>
                      {/* Conditional: Data Mode Toggle (for By Period) OR Period Selector (for By Metric) */}
                      {forecastLayout === 'byPeriod' ? (
                        <div className="flex bg-gray-100 p-1 rounded-lg">
                          <button
                            onClick={() => setForecastViewMode('velocity')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              forecastViewMode === 'velocity' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            Units/Day
                          </button>
                          <button
                            onClick={() => setForecastViewMode('daysLeft')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              forecastViewMode === 'daysLeft' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            Days Left
                          </button>
                          <button
                            onClick={() => setForecastViewMode('runOut')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              forecastViewMode === 'runOut' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            Run Out
                          </button>
                        </div>
                      ) : (
                        <div className="flex bg-gray-100 p-1 rounded-lg">
                          <button
                            onClick={() => setForecastSelectedPeriod('7d')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              forecastSelectedPeriod === '7d' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            7 Days
                          </button>
                          <button
                            onClick={() => setForecastSelectedPeriod('21d')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              forecastSelectedPeriod === '21d' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            21 Days
                          </button>
                          <button
                            onClick={() => setForecastSelectedPeriod('90d')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              forecastSelectedPeriod === '90d' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            90 Days
                          </button>
                          <button
                            onClick={() => setForecastSelectedPeriod('ly30d')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              forecastSelectedPeriod === 'ly30d' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            LY 30D
                          </button>
                        </div>
                      )}
                      <button onClick={refreshAllData} disabled={isRefreshing}
                        className={`px-3 py-2 text-xs font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                        {isRefreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
                      </button>
                    </div>
                    <input type="text" placeholder="Search by SKU or product..." value={forecastSearchTerm} onChange={(e) => setForecastSearchTerm(e.target.value)}
                      className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                {/* List View */}
                {forecastListMode === 'list' && (
                  <div className="bg-white shadow rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 table-fixed">
                        <thead className="bg-gray-50">
                          {forecastLayout === 'byPeriod' ? (
                            <tr>
                              <th className="w-32 px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('sku')}>
                                SKU <SortIcon active={forecastSortBy === 'sku'} order={forecastSortOrder} />
                              </th>
                              <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Inventory</th>
                              <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('avgDaily7d')}>
{forecastViewMode === 'velocity' ? '7 Days' : forecastViewMode === 'daysLeft' ? '7D Days' : '7D Run Out'} <SortIcon active={forecastSortBy === 'avgDaily7d'} order={forecastSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('avgDaily21d')}>
                              {forecastViewMode === 'velocity' ? '21 Days' : forecastViewMode === 'daysLeft' ? '21D Days' : '21D Run Out'} <SortIcon active={forecastSortBy === 'avgDaily21d'} order={forecastSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('avgDaily90d')}>
                              {forecastViewMode === 'velocity' ? '90 Days' : forecastViewMode === 'daysLeft' ? '90D Days' : '90D Run Out'} <SortIcon active={forecastSortBy === 'avgDaily90d'} order={forecastSortOrder} />
                              </th>
                              <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('avgDailyLastYear30d')}>
                                {forecastViewMode === 'velocity' ? 'LY 30D' : forecastViewMode === 'daysLeft' ? 'LY Days' : 'LY Run Out'} <SortIcon active={forecastSortBy === 'avgDailyLastYear30d'} order={forecastSortOrder} />
                              </th>
                            </tr>
                          ) : (
                            <tr>
                              <th className="w-32 px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('sku')}>
                                SKU <SortIcon active={forecastSortBy === 'sku'} order={forecastSortOrder} />
                              </th>
                              <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Inventory</th>
                              <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Units/Day</th>
                              <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Days Left</th>
                              <th className="w-28 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Run Out</th>
                            </tr>
                          )}
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {filteredForecasting.map((item, index) => {
                            const inventory = item.totalInventory || 0;
                            const days7d = calcDaysOfStock(inventory, item.avgDaily7d);
                            const days21d = calcDaysOfStock(inventory, item.avgDaily21d);
                            const days90d = calcDaysOfStock(inventory, item.avgDaily90d);
                            const daysLY30d = calcDaysOfStock(inventory, item.avgDailyLastYear30d);
                            
                            // For byMetric layout - get values for selected period
                            const getSelectedPeriodData = () => {
                              switch (forecastSelectedPeriod) {
                                case '7d': return { avgDaily: item.avgDaily7d, days: days7d };
                                case '21d': return { avgDaily: item.avgDaily21d, days: days21d };
                                case '90d': return { avgDaily: item.avgDaily90d, days: days90d };
                                case 'ly30d': return { avgDaily: item.avgDailyLastYear30d, days: daysLY30d };
                              }
                            };
                            const selectedData = getSelectedPeriodData();
                            
                            return (
                              <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="w-32 px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={item.productName}>{item.sku}</td>
                                <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${inventory <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{inventory.toLocaleString()}</td>
                                {forecastLayout === 'byPeriod' ? (
                                  forecastViewMode === 'velocity' ? (
                                    <>
                                      <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.avgDaily7d.toFixed(1)}</td>
                                      <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.avgDaily21d.toFixed(1)}</td>
                                      <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.avgDaily90d.toFixed(1)}</td>
                                      <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-500">{item.avgDailyLastYear30d.toFixed(1)}</td>
                                    </>
                                  ) : forecastViewMode === 'daysLeft' ? (
                                    <>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(days7d)}`}>{formatDaysOfStock(days7d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(days21d)}`}>{formatDaysOfStock(days21d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(days90d)}`}>{formatDaysOfStock(days90d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(daysLY30d)}`}>{formatDaysOfStock(daysLY30d)}</td>
                                    </>
                                  ) : (
                                    <>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(days7d)}`}>{formatRunOutDate(days7d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(days21d)}`}>{formatRunOutDate(days21d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(days90d)}`}>{formatRunOutDate(days90d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(daysLY30d)}`}>{formatRunOutDate(daysLY30d)}</td>
                                    </>
                                  )
                                ) : (
                                  <>
                                    <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{selectedData.avgDaily.toFixed(1)}</td>
                                    <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(selectedData.days)}`}>{formatDaysOfStock(selectedData.days)}</td>
                                    <td className={`w-28 px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(selectedData.days)}`}>{formatRunOutDate(selectedData.days)}</td>
                                  </>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {filteredForecasting.length === 0 && <div className="p-8 text-center text-gray-500">No forecasting data available.</div>}
                  </div>
                )}

                {/* Grouped View */}
                {forecastListMode === 'grouped' && (
                  <div className="space-y-4">
                    {sortedForecastGroupNames.length === 0 && (
                      <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">No forecasting data available.</div>
                    )}
                    {sortedForecastGroupNames.map(groupName => {
                      // Sort items - reverse alphabetical for Screen/Lens Protectors, otherwise alphabetical
                      const shouldReverseSort = groupName === 'Screen Protectors' || groupName === 'Lens Protectors';
                      const items = [...groupedForecasting[groupName]].sort((a, b) => 
                        shouldReverseSort ? b.sku.localeCompare(a.sku) : a.sku.localeCompare(b.sku)
                      );
                      const groupInventory = items.reduce((sum, item) => sum + (item.totalInventory || 0), 0);
                      return (
                        <div key={groupName} className="bg-white shadow rounded-lg overflow-hidden">
                          <div className="bg-gray-100 px-4 py-3 border-b border-gray-200">
                            <div className="flex justify-between items-center">
                              <h3 className="text-sm font-semibold text-gray-900">{groupName}</h3>
                              <div className="flex gap-4 text-xs text-gray-500">
                                <span>{items.length} SKUs</span>
                                <span className="font-medium text-gray-700">{groupInventory.toLocaleString()} units</span>
                              </div>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 table-fixed">
                              <thead className="bg-gray-50">
                                {forecastLayout === 'byPeriod' ? (
                                  <tr>
                                    <th className="w-32 px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                                    <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Inventory</th>
                                    <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">{forecastViewMode === 'velocity' ? '7 Days' : forecastViewMode === 'daysLeft' ? '7D Days' : '7D Run Out'}</th>
                                    <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">{forecastViewMode === 'velocity' ? '21 Days' : forecastViewMode === 'daysLeft' ? '21D Days' : '21D Run Out'}</th>
                                    <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">{forecastViewMode === 'velocity' ? '90 Days' : forecastViewMode === 'daysLeft' ? '90D Days' : '90D Run Out'}</th>
                                    <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">{forecastViewMode === 'velocity' ? 'LY 30D' : forecastViewMode === 'daysLeft' ? 'LY Days' : 'LY Run Out'}</th>
                                  </tr>
                                ) : (
                                  <tr>
                                    <th className="w-32 px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                                    <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Inventory</th>
                                    <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Units/Day</th>
                                    <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Days Left</th>
                                    <th className="w-28 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Run Out</th>
                                  </tr>
                                )}
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {items.map((item, index) => {
                                  const inventory = item.totalInventory || 0;
                                  const days7d = calcDaysOfStock(inventory, item.avgDaily7d);
                                  const days21d = calcDaysOfStock(inventory, item.avgDaily21d);
                                  const days90d = calcDaysOfStock(inventory, item.avgDaily90d);
                                  const daysLY30d = calcDaysOfStock(inventory, item.avgDailyLastYear30d);
                                  
                                  // For byMetric layout - get values for selected period
                                  const getSelectedPeriodData = () => {
                                    switch (forecastSelectedPeriod) {
                                      case '7d': return { avgDaily: item.avgDaily7d, days: days7d };
                                      case '21d': return { avgDaily: item.avgDaily21d, days: days21d };
                                      case '90d': return { avgDaily: item.avgDaily90d, days: days90d };
                                      case 'ly30d': return { avgDaily: item.avgDailyLastYear30d, days: daysLY30d };
                                    }
                                  };
                                  const selectedData = getSelectedPeriodData();
                                  
                                  return (
                                    <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                      <td className="w-32 px-3 sm:px-4 py-2 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={item.productName}>{item.sku}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${inventory <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{inventory.toLocaleString()}</td>
                                      {forecastLayout === 'byPeriod' ? (
                                        forecastViewMode === 'velocity' ? (
                                          <>
                                            <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{item.avgDaily7d.toFixed(1)}</td>
                                            <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{item.avgDaily21d.toFixed(1)}</td>
                                            <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{item.avgDaily90d.toFixed(1)}</td>
                                            <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-500">{item.avgDailyLastYear30d.toFixed(1)}</td>
                                          </>
                                        ) : forecastViewMode === 'daysLeft' ? (
                                          <>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(days7d)}`}>{formatDaysOfStock(days7d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(days21d)}`}>{formatDaysOfStock(days21d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(days90d)}`}>{formatDaysOfStock(days90d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(daysLY30d)}`}>{formatDaysOfStock(daysLY30d)}</td>
                                          </>
                                        ) : (
                                          <>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(days7d)}`}>{formatRunOutDate(days7d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(days21d)}`}>{formatRunOutDate(days21d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(days90d)}`}>{formatRunOutDate(days90d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(daysLY30d)}`}>{formatRunOutDate(daysLY30d)}</td>
                                          </>
                                        )
                                      ) : (
                                        <>
                                          <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{selectedData.avgDaily.toFixed(1)}</td>
                                          <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(selectedData.days)}`}>{formatDaysOfStock(selectedData.days)}</td>
                                          <td className={`w-28 px-3 sm:px-4 py-2 text-sm text-center ${getDaysColor(selectedData.days)}`}>{formatRunOutDate(selectedData.days)}</td>
                                        </>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Planning Tab */}
        {activeTab === 'planning' && (
          <>
            {(inventoryLoading || forecastingLoading) && (
              <div className="bg-white rounded-lg shadow-md p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading planning data...</p>
              </div>
            )}

            {(inventoryError || forecastingError) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-4 text-center">
                <p className="text-sm text-yellow-800 mb-4">{inventoryError || forecastingError}</p>
                <button onClick={refreshAllData} disabled={isRefreshing}
                  className={`px-4 py-2 text-sm font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                  {isRefreshing ? '⏳ Loading data from Shopify...' : '🔄 Refresh Data'}
                </button>
              </div>
            )}

            {!inventoryLoading && !forecastingLoading && inventoryData && forecastingData && (
              <div className="space-y-6">
                <div className="bg-white shadow rounded-lg p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                    <div className="flex gap-2 flex-wrap items-center">
                      <select 
                        value={planningFilterCategory} 
                        onChange={(e) => setPlanningFilterCategory(e.target.value)}
                        className="px-3 py-2 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="all">All Categories</option>
                        {PRODUCT_CATEGORIES.map(cat => (
                          <option key={cat.name} value={cat.name}>{cat.name}</option>
                        ))}
                      </select>
                      {/* List/Grouped Toggle */}
                      <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button onClick={() => setPlanningListMode('list')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${planningListMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                          List
                        </button>
                        <button onClick={() => setPlanningListMode('grouped')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${planningListMode === 'grouped' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                          Grouped
                        </button>
                      </div>
                      {/* Burn Rate Period Toggle */}
                      <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button
                          onClick={() => setPlanningBurnPeriod('7d')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            planningBurnPeriod === '7d' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          7 Days
                        </button>
                        <button
                          onClick={() => setPlanningBurnPeriod('21d')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            planningBurnPeriod === '21d' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          21 Days
                        </button>
                        <button
                          onClick={() => setPlanningBurnPeriod('90d')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            planningBurnPeriod === '90d' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          90 Days
                        </button>
                      </div>
                      <button onClick={refreshAllData} disabled={isRefreshing}
                        className={`px-3 py-2 text-xs font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                        {isRefreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
                      </button>
                    </div>
                    <input type="text" placeholder="Search by SKU or product..." value={planningSearchTerm} onChange={(e) => setPlanningSearchTerm(e.target.value)}
                      className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                {(() => {
                  // Build planning data by combining inventory and forecasting
                  const inventoriedSkus = new Set(inventoryData.inventory.map(item => item.sku));
                  
                  // Get LA inventory (LA Office + DTLA WH available)
                  const getLAInventory = (sku: string): number => {
                    const inv = inventoryData.inventory.find(i => i.sku === sku);
                    if (!inv) return 0;
                    const laOffice = inv.locations['LA Office'] || 0;
                    const dtlaWH = inv.locations['DTLA WH'] || 0;
                    return laOffice + dtlaWH;
                  };
                  
                  // Get incoming to LA Office (from locationDetails)
                  const getLAIncoming = (sku: string): number => {
                    const laDetails = inventoryData.locationDetails?.['LA Office'];
                    if (!laDetails) return 0;
                    const detail = laDetails.find(d => d.sku === sku);
                    return detail?.incoming || 0;
                  };
                  
                  // Get China WH inventory
                  const getChinaInventory = (sku: string): number => {
                    const inv = inventoryData.inventory.find(i => i.sku === sku);
                    if (!inv) return 0;
                    return inv.locations['China WH'] || 0;
                  };
                  
                  // Get units per day based on selected burn period
                  const getUnitsPerDay = (sku: string): number => {
                    const forecast = forecastingData.forecasting.find(f => f.sku === sku);
                    if (!forecast) return 0;
                    switch (planningBurnPeriod) {
                      case '7d': return forecast.avgDaily7d;
                      case '21d': return forecast.avgDaily21d;
                      case '90d': return forecast.avgDaily90d;
                      default: return forecast.avgDaily21d;
                    }
                  };
                  
                  // Get pending PO quantity for a SKU (from manual production orders)
                  const getPOQuantity = (sku: string): number => {
                    const po = purchaseOrderData?.purchaseOrders?.find(p => p.sku === sku);
                    return po?.pendingQuantity || 0;
                  };
                  
                  // Calculate ship type
                  const getShipType = (laInventory: number, incoming: number, chinaInventory: number, unitsPerDay: number): string => {
                    const laTotal = laInventory + incoming;
                    const daysOfStock = unitsPerDay > 0 ? laTotal / unitsPerDay : 999;
                    
                    if (chinaInventory > 0) {
                      if (daysOfStock <= 15) return 'Express';
                      if (daysOfStock <= 60) return 'Slow Air';
                      if (daysOfStock <= 90) return 'Sea';
                      return 'No Action';
                    } else {
                      // No China inventory - check LA + Incoming
                      if (daysOfStock < 60) return 'No CN Inv';
                      return 'No Action';
                    }
                  };
                  
                  // Get ship type color
                  const getShipTypeColor = (shipType: string): string => {
                    switch (shipType) {
                      case 'Express': return 'bg-red-100 text-red-800';
                      case 'Slow Air': return 'bg-orange-100 text-orange-800';
                      case 'Sea': return 'bg-blue-100 text-blue-800';
                      case 'No CN Inv': return 'bg-purple-100 text-purple-800';
                      case 'No Action': return 'bg-green-100 text-green-800';
                      default: return 'bg-gray-100 text-gray-800';
                    }
                  };
                  
                  // Ship type sort order (most urgent first)
                  const shipTypePriority: Record<string, number> = {
                    'Express': 1,
                    'No CN Inv': 2,
                    'Slow Air': 3,
                    'Sea': 4,
                    'No Action': 5,
                  };
                  
                  // Build planning items
                  const planningItems = inventoryData.inventory
                    .filter(inv => {
                      // Filter by search term
                      const matchesSearch = !planningSearchTerm || 
                        inv.sku.toLowerCase().includes(planningSearchTerm.toLowerCase()) ||
                        inv.productTitle.toLowerCase().includes(planningSearchTerm.toLowerCase());
                      // Filter by category
                      if (planningFilterCategory !== 'all') {
                        const category = findProductCategory(inv.sku, inv.productTitle);
                        if (!category || category.name !== planningFilterCategory) return false;
                      }
                      return matchesSearch;
                    })
                    .map(inv => {
                      const laInventory = getLAInventory(inv.sku);
                      const incoming = getLAIncoming(inv.sku);
                      const chinaInventory = getChinaInventory(inv.sku);
                      const poQty = getPOQuantity(inv.sku);
                      const unitsPerDay = getUnitsPerDay(inv.sku);
                      const shipType = getShipType(laInventory, incoming, chinaInventory, unitsPerDay);
                      
                      return {
                        sku: inv.sku,
                        productTitle: inv.productTitle,
                        la: laInventory,
                        incoming,
                        china: chinaInventory,
                        poQty,
                        unitsPerDay,
                        shipType,
                      };
                    })
                    .sort((a, b) => {
                      let comparison = 0;
                      switch (planningSortBy) {
                        case 'sku': comparison = a.sku.localeCompare(b.sku); break;
                        case 'la': comparison = a.la - b.la; break;
                        case 'incoming': comparison = a.incoming - b.incoming; break;
                        case 'china': comparison = a.china - b.china; break;
                        case 'poQty': comparison = a.poQty - b.poQty; break;
                        case 'unitsPerDay': comparison = a.unitsPerDay - b.unitsPerDay; break;
                        case 'shipType': comparison = (shipTypePriority[a.shipType] || 99) - (shipTypePriority[b.shipType] || 99); break;
                      }
                      return planningSortOrder === 'asc' ? comparison : -comparison;
                    });
                  
                  // Group by product model if in grouped mode
                  const groupedPlanning = planningListMode === 'grouped' 
                    ? planningItems.reduce((groups, item) => {
                        const model = extractProductModel(item.productTitle, item.sku);
                        if (!groups[model]) groups[model] = [];
                        groups[model].push(item);
                        return groups;
                      }, {} as Record<string, typeof planningItems>)
                    : { 'All SKUs': planningItems };
                  
                  const sortedPlanningGroupNames = Object.keys(groupedPlanning).sort((a, b) => {
                    return getModelPriority(b) - getModelPriority(a);
                  });
                  
                  const handlePlanningSort = (column: typeof planningSortBy) => {
                    if (planningSortBy === column) {
                      setPlanningSortOrder(planningSortOrder === 'asc' ? 'desc' : 'asc');
                    } else {
                      setPlanningSortBy(column);
                      setPlanningSortOrder(column === 'shipType' ? 'asc' : 'desc');
                    }
                  };
                  
                  const PlanningTable = ({ items, showHeader = true }: { items: typeof planningItems; showHeader?: boolean }) => (
                    <table className="min-w-full divide-y divide-gray-200 table-fixed">
                      {showHeader && (
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-32 px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('sku')}>
                              SKU <SortIcon active={planningSortBy === 'sku'} order={planningSortOrder} />
                            </th>
                            <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('la')}>
                              LA <SortIcon active={planningSortBy === 'la'} order={planningSortOrder} />
                            </th>
                            <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('incoming')}>
                              Incoming <SortIcon active={planningSortBy === 'incoming'} order={planningSortOrder} />
                            </th>
                            <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('china')}>
                              China <SortIcon active={planningSortBy === 'china'} order={planningSortOrder} />
                            </th>
                            <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('poQty')}>
                              PO Qty <SortIcon active={planningSortBy === 'poQty'} order={planningSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('unitsPerDay')}>
                              Units/Day <SortIcon active={planningSortBy === 'unitsPerDay'} order={planningSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('shipType')}>
                              Ship Type <SortIcon active={planningSortBy === 'shipType'} order={planningSortOrder} />
                            </th>
                          </tr>
                        </thead>
                      )}
                      <tbody className="bg-white divide-y divide-gray-200">
                        {items.map((item, index) => (
                          <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="w-32 px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={item.productTitle}>{item.sku}</td>
                            <td className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.la <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{item.la.toLocaleString()}</td>
                            <td className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.incoming > 0 ? 'text-purple-600 font-medium' : 'text-gray-900'}`}>{item.incoming.toLocaleString()}</td>
                            <td className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.china <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{item.china.toLocaleString()}</td>
                            <td className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.poQty > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{item.poQty > 0 ? item.poQty.toLocaleString() : '—'}</td>
                            <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.unitsPerDay.toFixed(1)}</td>
                            <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getShipTypeColor(item.shipType)}`}>
                                {item.shipType}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                  
                  return (
                    <>
                      {/* List View */}
                      {planningListMode === 'list' && (
                        <div className="bg-white shadow rounded-lg overflow-hidden">
                          <div className="overflow-x-auto">
                            <PlanningTable items={planningItems} />
                          </div>
                          {planningItems.length === 0 && <div className="p-8 text-center text-gray-500">No planning data available.</div>}
                        </div>
                      )}
                      
                      {/* Grouped View */}
                      {planningListMode === 'grouped' && (
                        <div className="space-y-4">
                          {sortedPlanningGroupNames.length === 0 && (
                            <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">No planning data available.</div>
                          )}
                          {sortedPlanningGroupNames.map(groupName => {
                            const items = groupedPlanning[groupName];
                            // Sort items within group - reverse for protectors
                            const shouldReverseSort = groupName === 'Screen Protectors' || groupName === 'Lens Protectors';
                            const sortedItems = [...items].sort((a, b) => 
                              shouldReverseSort ? b.sku.localeCompare(a.sku) : a.sku.localeCompare(b.sku)
                            );
                            return (
                              <div key={groupName} className="bg-white shadow rounded-lg overflow-hidden">
                                <div className="bg-gray-100 px-4 py-3 border-b border-gray-200">
                                  <div className="flex justify-between items-center">
                                    <h3 className="text-sm font-semibold text-gray-900">{groupName}</h3>
                                    <div className="flex gap-4 text-xs text-gray-500">
                                      <span>{items.length} SKUs</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full divide-y divide-gray-200 table-fixed">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="w-32 px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                                        <th className="w-20 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">LA</th>
                                        <th className="w-20 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Incoming</th>
                                        <th className="w-20 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">China</th>
                                        <th className="w-20 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">PO Qty</th>
                                        <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Units/Day</th>
                                        <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Ship Type</th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                      {sortedItems.map((item, index) => (
                                        <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                          <td className="w-32 px-3 sm:px-4 py-2 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={item.productTitle}>{item.sku}</td>
                                          <td className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${item.la <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{item.la.toLocaleString()}</td>
                                          <td className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${item.incoming > 0 ? 'text-purple-600 font-medium' : 'text-gray-900'}`}>{item.incoming.toLocaleString()}</td>
                                          <td className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${item.china <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{item.china.toLocaleString()}</td>
                                          <td className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${item.poQty > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{item.poQty > 0 ? item.poQty.toLocaleString() : '—'}</td>
                                          <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{item.unitsPerDay.toFixed(1)}</td>
                                          <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getShipTypeColor(item.shipType)}`}>
                                              {item.shipType}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* Production Tab */}
        {activeTab === 'production' && (
          <div className="space-y-4">
            {/* Header with New Order button */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <select
                  value={productionFilterStatus}
                  onChange={(e) => setProductionFilterStatus(e.target.value as 'all' | 'open' | 'completed')}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
                >
                  <option value="all">All Orders</option>
                  <option value="open">Open Orders</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => setShowNewOrderForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
              >
                + New Production Order
              </button>
            </div>

            {/* Orders List */}
            {productionOrdersLoading ? (
              <div className="bg-white shadow rounded-lg p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-2 text-gray-600">Loading orders...</p>
              </div>
            ) : (
              <div className="bg-white shadow rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKUs</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ETA</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {productionOrders
                      .filter(order => {
                        if (productionFilterStatus === 'open') return ['in_production', 'partial'].includes(order.status);
                        if (productionFilterStatus === 'completed') return ['completed', 'cancelled'].includes(order.status);
                        return true;
                      })
                      .map((order) => {
                        const totalOrdered = order.items.reduce((sum, i) => sum + i.quantity, 0);
                        const totalReceived = order.items.reduce((sum, i) => sum + (i.receivedQuantity || 0), 0);
                        const isExpanded = selectedOrder?.id === order.id;
                        // Create SKU preview (up to 20 chars)
                        const skuList = order.items.map(i => i.sku).join(', ');
                        const skuPreview = skuList.length > 20 ? skuList.slice(0, 17) + '...' : skuList;
                        return (
                          <Fragment key={order.id}>
                            <tr 
                              className={`cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                              onClick={() => setSelectedOrder(isExpanded ? null : order)}
                            >
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                <span className="flex items-center gap-2">
                                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                  {order.id.split('-').slice(0, 2).join('-')}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600 font-mono" title={skuList}>{skuPreview}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {order.items.length} SKU{order.items.length !== 1 ? 's' : ''} 
                                <span className="text-gray-400 ml-1">
                                  ({totalReceived.toLocaleString()}/{totalOrdered.toLocaleString()})
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">{order.vendor || '—'}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {order.eta ? new Date(order.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  order.status === 'in_production' ? 'bg-blue-100 text-blue-800' :
                                  order.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                                  order.status === 'completed' ? 'bg-green-100 text-green-800' :
                                  order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {order.status === 'in_production' ? 'In Production' : 
                                   order.status === 'partial' ? 'Partial Delivery' : 
                                   order.status === 'cancelled' ? 'Cancelled' :
                                   'Completed'}
                                </span>
                              </td>
                            </tr>
                            {/* Expanded Details Row */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={6} className="bg-gray-50 px-4 py-4">
                                  <div className="space-y-4">
                                    {/* Meta info */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                      <div>
                                        <span className="text-gray-500">Created by:</span>
                                        <span className="ml-2 text-gray-900">{order.createdBy}</span>
                                      </div>
                                      <div>
                                        <span className="text-gray-500">Vendor:</span>
                                        <span className="ml-2 text-gray-900">{order.vendor || '—'}</span>
                                      </div>
                                      <div>
                                        <span className="text-gray-500">Created:</span>
                                        <span className="ml-2 text-gray-900">
                                          {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-gray-500">Last updated:</span>
                                        <span className="ml-2 text-gray-900">
                                          {new Date(order.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </span>
                                      </div>
                                    </div>
                                    {/* Items Table */}
                                    <div>
                                      <h4 className="text-sm font-medium text-gray-700 mb-2">Items ({order.items.length})</h4>
                                      <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
                                        <table className="min-w-full divide-y divide-gray-200">
                                          <thead className="bg-gray-100">
                                            <tr>
                                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Ordered</th>
                                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Received</th>
                                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Pending</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-200">
                                            {order.items.map((item, index) => {
                                              const pending = item.quantity - (item.receivedQuantity || 0);
                                              return (
                                                <tr key={index}>
                                                  <td className="px-4 py-2 text-sm text-gray-900 font-mono">{item.sku}</td>
                                                  <td className="px-4 py-2 text-sm text-gray-900 text-right">{item.quantity.toLocaleString()}</td>
                                                  <td className="px-4 py-2 text-sm text-green-600 text-right">{(item.receivedQuantity || 0).toLocaleString()}</td>
                                                  <td className={`px-4 py-2 text-sm text-right ${pending > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
                                                    {pending.toLocaleString()}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                            <tr className="bg-gray-100">
                                              <td className="px-4 py-2 text-sm font-medium text-gray-900">Total</td>
                                              <td className="px-4 py-2 text-sm font-medium text-gray-900 text-right">
                                                {order.items.reduce((sum, i) => sum + i.quantity, 0).toLocaleString()}
                                              </td>
                                              <td className="px-4 py-2 text-sm font-medium text-green-600 text-right">
                                                {order.items.reduce((sum, i) => sum + (i.receivedQuantity || 0), 0).toLocaleString()}
                                              </td>
                                              <td className="px-4 py-2 text-sm font-medium text-orange-600 text-right">
                                                {order.items.reduce((sum, i) => sum + (i.quantity - (i.receivedQuantity || 0)), 0).toLocaleString()}
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                    {/* Notes */}
                                    {order.notes && (
                                      <div>
                                        <h4 className="text-sm font-medium text-gray-700 mb-2">Notes</h4>
                                        <p className="text-sm text-gray-600 bg-white p-3 rounded-md border border-gray-200">{order.notes}</p>
                                      </div>
                                    )}
                                    {/* Actions */}
                                    <div className="flex gap-2 pt-2">
                                      {!['completed', 'cancelled'].includes(order.status) ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setDeliveryItems(
                                                order.items
                                                  .filter(item => item.quantity - (item.receivedQuantity || 0) > 0)
                                                  .map(item => ({ 
                                                    sku: item.sku, 
                                                    quantity: String(item.quantity - (item.receivedQuantity || 0))
                                                  }))
                                              );
                                              setShowDeliveryForm(true);
                                            }}
                                            className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 active:bg-green-800"
                                          >
                                            Log Delivery
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditOrderItems(order.items.map(i => ({ sku: i.sku, quantity: String(i.quantity) })));
                                              setEditOrderVendor(order.vendor || '');
                                              setEditOrderEta(order.eta || '');
                                              setEditOrderNotes(order.notes || '');
                                              setShowEditForm(true);
                                            }}
                                            className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              updateOrderStatus(order.id, 'completed');
                                            }}
                                            className="px-3 py-1.5 text-gray-600 hover:bg-gray-200 active:bg-gray-300 rounded-md text-sm font-medium"
                                          >
                                            Mark Complete
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setShowCancelConfirm(true);
                                            }}
                                            className="px-3 py-1.5 text-red-600 hover:bg-red-100 active:bg-red-200 rounded-md text-sm font-medium"
                                          >
                                            Cancel Order
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setNewOrderItems(order.items.map(i => ({ sku: i.sku, quantity: String(i.quantity) })));
                                            setNewOrderVendor(order.vendor || '');
                                            setNewOrderEta('');
                                            setNewOrderNotes(order.notes || '');
                                            setSelectedOrder(null);
                                            setShowNewOrderForm(true);
                                          }}
                                          className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
                                        >
                                          Duplicate Order
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    {productionOrders.filter(order => {
                      if (productionFilterStatus === 'open') return ['in_production', 'partial'].includes(order.status);
                      if (productionFilterStatus === 'completed') return ['completed', 'cancelled'].includes(order.status);
                      return true;
                    }).length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                          No orders found. Click "New Production Order" to create one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* New Order Modal */}
            {showNewOrderForm && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">New Production Order</h3>
                  </div>
                  <div className="px-6 py-4 space-y-4">
                    {/* Items */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Items</label>
                      {newOrderItems.map((item, index) => {
                        // Get SKU suggestions based on input
                        const inputValue = item.sku.toUpperCase();
                        const skuSuggestions = inputValue.length >= 2 && inventoryData
                          ? inventoryData.inventory
                              .filter(inv => inv.sku.toUpperCase().includes(inputValue))
                              .slice(0, 8)
                              .map(inv => inv.sku)
                          : [];
                        
                        return (
                          <div key={index} className="flex gap-2 mb-2">
                            <div className="relative flex-1">
                              <input
                                type="text"
                                placeholder="SKU"
                                value={item.sku}
                                onChange={(e) => {
                                  const updated = [...newOrderItems];
                                  updated[index].sku = e.target.value.toUpperCase();
                                  setNewOrderItems(updated);
                                  setSkuSuggestionIndex(index);
                                }}
                                onFocus={() => setSkuSuggestionIndex(index)}
                                onBlur={() => setTimeout(() => setSkuSuggestionIndex(null), 150)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                              />
                              {/* SKU Suggestions Dropdown */}
                              {skuSuggestionIndex === index && skuSuggestions.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                  {skuSuggestions.map((sku) => (
                                    <button
                                      key={sku}
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        const updated = [...newOrderItems];
                                        updated[index].sku = sku;
                                        setNewOrderItems(updated);
                                        setSkuSuggestionIndex(null);
                                      }}
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 hover:text-blue-700"
                                    >
                                      {sku}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <input
                              type="number"
                              placeholder="Qty"
                              value={item.quantity}
                              onChange={(e) => {
                                const updated = [...newOrderItems];
                                updated[index].quantity = e.target.value;
                                setNewOrderItems(updated);
                              }}
                              className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                            {newOrderItems.length > 1 && (
                              <button
                                onClick={() => setNewOrderItems(newOrderItems.filter((_, i) => i !== index))}
                                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <button
                        onClick={() => setNewOrderItems([...newOrderItems, { sku: '', quantity: '' }])}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        + Add another SKU
                      </button>
                    </div>
                    {/* Vendor and ETA */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Vendor (optional)</label>
                        <input
                          type="text"
                          value={newOrderVendor}
                          onChange={(e) => setNewOrderVendor(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                          placeholder="e.g. Factory ABC"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">ETA (optional)</label>
                        <input
                          type="date"
                          value={newOrderEta}
                          onChange={(e) => setNewOrderEta(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        />
                      </div>
                    </div>
                    {/* Notes */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Notes / Comments (optional)</label>
                      <textarea
                        value={newOrderNotes}
                        onChange={(e) => setNewOrderNotes(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        placeholder="Additional notes..."
                      />
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewOrderForm(false);
                        setNewOrderItems([{ sku: '', quantity: '' }]);
                        setNewOrderNotes('');
                        setNewOrderVendor('');
                        setNewOrderEta('');
                      }}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={createProductionOrder}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
                    >
                      Create Order
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Log Delivery Modal */}
            {showDeliveryForm && selectedOrder && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Log Delivery</h3>
                    <p className="text-sm text-gray-500 mt-1">Enter quantities received for each SKU</p>
                  </div>
                  <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
                    {deliveryItems.map((item, index) => {
                      const orderItem = selectedOrder.items.find(i => i.sku === item.sku);
                      const remaining = orderItem ? orderItem.quantity - (orderItem.receivedQuantity || 0) : 0;
                      return (
                        <div key={index} className="flex items-center gap-3">
                          <span className="text-sm font-medium text-gray-900 w-32">{item.sku}</span>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => {
                              const updated = [...deliveryItems];
                              updated[index].quantity = e.target.value;
                              setDeliveryItems(updated);
                            }}
                            min="0"
                            max={remaining}
                            className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                          />
                          <span className="text-sm text-gray-500">of {remaining} remaining</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowDeliveryForm(false);
                        setDeliveryItems([]);
                      }}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => logDelivery(selectedOrder.id)}
                      className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 active:bg-green-800"
                    >
                      Confirm Delivery
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Edit Order Modal */}
            {showEditForm && selectedOrder && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Edit {selectedOrder.id}</h3>
                  </div>
                  <div className="px-6 py-4 space-y-4">
                    {/* Items */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Items</label>
                      {editOrderItems.map((item, index) => (
                        <div key={index} className="flex gap-2 mb-2">
                          <input
                            type="text"
                            placeholder="SKU"
                            value={item.sku}
                            onChange={(e) => {
                              const updated = [...editOrderItems];
                              updated[index].sku = e.target.value.toUpperCase();
                              setEditOrderItems(updated);
                            }}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                          />
                          <input
                            type="number"
                            placeholder="Qty"
                            value={item.quantity}
                            onChange={(e) => {
                              const updated = [...editOrderItems];
                              updated[index].quantity = e.target.value;
                              setEditOrderItems(updated);
                            }}
                            className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                          />
                          {editOrderItems.length > 1 && (
                            <button
                              onClick={() => setEditOrderItems(editOrderItems.filter((_, i) => i !== index))}
                              className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={() => setEditOrderItems([...editOrderItems, { sku: '', quantity: '' }])}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        + Add another SKU
                      </button>
                    </div>
                    {/* Vendor and ETA */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Vendor</label>
                        <input
                          type="text"
                          value={editOrderVendor}
                          onChange={(e) => setEditOrderVendor(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">ETA</label>
                        <input
                          type="date"
                          value={editOrderEta}
                          onChange={(e) => setEditOrderEta(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        />
                      </div>
                    </div>
                    {/* Notes */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                      <textarea
                        value={editOrderNotes}
                        onChange={(e) => setEditOrderNotes(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowEditForm(false)}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEditOrder(selectedOrder.id)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Cancel Confirmation Modal */}
            {showCancelConfirm && selectedOrder && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Cancel Order?</h3>
                  </div>
                  <div className="px-6 py-4">
                    <p className="text-gray-600">
                      Are you sure you want to cancel <span className="font-medium">{selectedOrder.id}</span>? 
                      This action cannot be undone.
                    </p>
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(false)}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                    >
                      Keep Order
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelOrder(selectedOrder.id)}
                      className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 active:bg-red-800"
                    >
                      Yes, Cancel Order
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
