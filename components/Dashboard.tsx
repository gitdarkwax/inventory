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
  inboundAir: number;
  inboundSea: number;
  transferNotes: Array<{ id: string; note: string | null }>;
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

interface ActivityLogEntry {
  timestamp: string;
  action: string;
  changedBy: string;
  changedByEmail: string;
  details?: string;
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
  activityLog?: ActivityLogEntry[];
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
  const [sortBy, setSortBy] = useState<string>('sku');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [filterOutOfStock, setFilterOutOfStock] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [inventoryViewMode, setInventoryViewMode] = useState<'list' | 'grouped'>('grouped');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [inventoryLocationFilter, setInventoryLocationFilter] = useState<string | null>(null);
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
  const [planningFilterShipType, setPlanningFilterShipType] = useState<string>('all');
  const [planningFilterProdStatus, setPlanningFilterProdStatus] = useState<string>('all');
  const [planningListMode, setPlanningListMode] = useState<'list' | 'grouped'>('grouped');
  const [planningSortBy, setPlanningSortBy] = useState<'sku' | 'la' | 'inboundAir' | 'inboundSea' | 'china' | 'poQty' | 'unitsPerDay' | 'laNeed' | 'shipType' | 'runwayAir' | 'prodStatus' | 'runway'>('shipType');
  const [planningSortOrder, setPlanningSortOrder] = useState<'asc' | 'desc'>('asc');
  const [planningLaTargetDays, setPlanningLaTargetDays] = useState<number>(30);

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
  const [skuSearchQuery, setSkuSearchQuery] = useState('');
  const [skuSearchDateFrom, setSkuSearchDateFrom] = useState('');
  const [skuSearchDateTo, setSkuSearchDateTo] = useState('');
  const [skuSuggestionIndex, setSkuSuggestionIndex] = useState<number | null>(null);
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [deliveryItems, setDeliveryItems] = useState<{ sku: string; quantity: string }[]>([]);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editOrderItems, setEditOrderItems] = useState<{ sku: string; quantity: string }[]>([]);
  const [editOrderVendor, setEditOrderVendor] = useState('');
  const [editOrderEta, setEditOrderEta] = useState('');
  const [editOrderNotes, setEditOrderNotes] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isLoggingDelivery, setIsLoggingDelivery] = useState(false);

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Phase out state
  const [showPhaseOutModal, setShowPhaseOutModal] = useState(false);
  const [phaseOutSkus, setPhaseOutSkus] = useState<string[]>([]);
  const [newPhaseOutSku, setNewPhaseOutSku] = useState('');
  const [isAddingPhaseOut, setIsAddingPhaseOut] = useState(false);
  const [isRemovingPhaseOut, setIsRemovingPhaseOut] = useState<string | null>(null);

  // Load phase out SKUs
  const loadPhaseOutSkus = async () => {
    try {
      const response = await fetch('/api/phase-out');
      if (response.ok) {
        const data = await response.json();
        setPhaseOutSkus(data.skus?.map((s: { sku: string }) => s.sku) || []);
      }
    } catch (error) {
      console.error('Error loading phase out SKUs:', error);
    }
  };

  // Add SKU to phase out list
  const addPhaseOutSku = async () => {
    if (!newPhaseOutSku.trim() || isAddingPhaseOut) return;
    setIsAddingPhaseOut(true);
    try {
      const response = await fetch('/api/phase-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: newPhaseOutSku.trim() }),
      });
      if (response.ok) {
        const data = await response.json();
        setPhaseOutSkus(data.skus?.map((s: { sku: string }) => s.sku) || []);
        setNewPhaseOutSku('');
      }
    } catch (error) {
      console.error('Error adding phase out SKU:', error);
    } finally {
      setIsAddingPhaseOut(false);
    }
  };

  // Remove SKU from phase out list
  const removePhaseOutSku = async (sku: string) => {
    if (isRemovingPhaseOut) return;
    setIsRemovingPhaseOut(sku);
    try {
      const response = await fetch(`/api/phase-out?sku=${encodeURIComponent(sku)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        const data = await response.json();
        setPhaseOutSkus(data.skus?.map((s: { sku: string }) => s.sku) || []);
      }
    } catch (error) {
      console.error('Error removing phase out SKU:', error);
    } finally {
      setIsRemovingPhaseOut(null);
    }
  };

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
    if (isCreatingOrder) return; // Prevent double-clicks
    
    const validItems = newOrderItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ sku: item.sku.trim().toUpperCase(), quantity: parseInt(item.quantity) }));

    if (validItems.length === 0) {
      alert('Please add at least one item with a valid SKU and quantity');
      return;
    }

    setIsCreatingOrder(true);
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
    } finally {
      setIsCreatingOrder(false);
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
    if (isLoggingDelivery) return; // Prevent double-clicks
    
    const validDeliveries = deliveryItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ sku: item.sku.trim().toUpperCase(), quantity: parseInt(item.quantity) }));

    if (validDeliveries.length === 0) {
      alert('Please enter at least one delivery quantity');
      return;
    }

    setIsLoggingDelivery(true);
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
    } finally {
      setIsLoggingDelivery(false);
    }
  };

  // Save edited production order
  const saveEditOrder = async (orderId: string) => {
    if (isSavingOrder) return; // Prevent double-clicks
    
    const validItems = editOrderItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ sku: item.sku.trim().toUpperCase(), quantity: parseInt(item.quantity) }));

    if (validItems.length === 0) {
      alert('Please add at least one item with a valid SKU and quantity');
      return;
    }

    setIsSavingOrder(true);
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
    } finally {
      setIsSavingOrder(false);
    }
  };

  // Cancel production order
  const cancelOrder = async (orderId: string) => {
    if (isCancellingOrder) return; // Prevent double-clicks
    
    setIsCancellingOrder(true);
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
    } finally {
      setIsCancellingOrder(false);
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
    loadPhaseOutSkus(); // Load phase out list
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
      // Filter by location if a location filter is set
      if (inventoryLocationFilter) {
        const locationQty = item.locations[inventoryLocationFilter] || 0;
        if (locationQty <= 0) return false;
      }
      return matchesSearch;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'sku') {
        comparison = a.sku.localeCompare(b.sku);
      } else if (sortBy === 'total') {
        comparison = a.totalAvailable - b.totalAvailable;
      } else {
        // Sort by location quantity
        const aQty = a.locations[sortBy] || 0;
        const bQty = b.locations[sortBy] || 0;
        comparison = aQty - bQty;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    }) || [];

  // Filter and sort location detail (uses either inventoryLocationFilter for inline view or selectedLocation for modal)
  const activeLocationFilter = inventoryLocationFilter || selectedLocation;
  const filteredLocationDetail = activeLocationFilter && inventoryData?.locationDetails?.[activeLocationFilter]
    ? inventoryData.locationDetails[activeLocationFilter]
        .filter(item => {
          // Use main searchTerm for inline view, locationSearchTerm for modal
          const activeSearchTerm = inventoryLocationFilter ? searchTerm : locationSearchTerm;
          const matchesSearch = !activeSearchTerm || 
            item.sku.toLowerCase().includes(activeSearchTerm.toLowerCase()) ||
            item.productTitle.toLowerCase().includes(activeSearchTerm.toLowerCase());
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

  const handleSort = (column: string) => {
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

          {/* Phase Out Link */}
          <div className="flex justify-end mb-1">
            <button
              onClick={() => setShowPhaseOutModal(true)}
              className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
            >
              Manage Phase Outs
            </button>
          </div>
          
          {/* Tabs and Refresh */}
          <div className="flex items-center justify-between">
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
                📋 LA Planning
              </button>
              <button
                onClick={() => setActiveTab('production')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'production' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
                }`}
              >
                📦 PO Tracker
              </button>
            </div>
            <button 
              onClick={refreshAllData} 
              disabled={isRefreshing}
              className={`px-4 py-2 text-sm font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
            >
              {isRefreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
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
                {/* Location Tiles */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  {inventoryData.locations.map((location, idx) => {
                    const locationTotal = inventoryData.inventory.reduce((sum, item) => sum + (item.locations[location] || 0), 0);
                    const colors = ['blue', 'green', 'purple', 'orange'];
                    const color = colors[idx % colors.length];
                    const isSelected = inventoryLocationFilter === location;
                    const borderClass = isSelected 
                      ? color === 'blue' ? 'border-blue-500' 
                      : color === 'green' ? 'border-green-500' 
                      : color === 'purple' ? 'border-purple-500' 
                      : 'border-orange-500'
                      : 'border-transparent';
                    const hoverClass = color === 'blue' ? 'hover:border-blue-300' 
                      : color === 'green' ? 'hover:border-green-300' 
                      : color === 'purple' ? 'hover:border-purple-300' 
                      : 'hover:border-orange-300';
                    const textColorClass = color === 'blue' ? 'text-blue-600' 
                      : color === 'green' ? 'text-green-600' 
                      : color === 'purple' ? 'text-purple-600' 
                      : 'text-orange-600';
                    return (
                      <button
                        key={location}
                        onClick={() => setInventoryLocationFilter(isSelected ? null : location)}
                        className={`text-center bg-white shadow rounded-lg p-3 sm:p-4 border-2 transition-all cursor-pointer ${hoverClass} ${borderClass}`}
                      >
                        <p className="text-xs sm:text-sm font-medium text-gray-500">{location}</p>
                        <p className={`text-lg sm:text-xl font-bold ${textColorClass}`}>
                          {locationTotal.toLocaleString()}
                        </p>
                      </button>
                    );
                  })}
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
                            {inventoryLocationFilter ? (
                              <>
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
                              </>
                            ) : (
                              <>
                                {inventoryData.locations.map(location => (
                                  <th key={location} className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                                    onClick={() => handleSort(location)}>
                                    {location} <SortIcon active={sortBy === location} order={sortOrder} />
                                  </th>
                                ))}
                                <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('total')}>
                                  Total <SortIcon active={sortBy === 'total'} order={sortOrder} />
                                </th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {inventoryLocationFilter ? (
                            // Location Detail View
                            filteredLocationDetail.map((item, index) => (
                              <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="w-32 px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis"
                                  title={`${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`}>{item.sku}</td>
                                <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${item.onHand <= 0 ? 'text-red-600 font-medium' : item.onHand <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                                  {item.onHand.toLocaleString()}
                                </td>
                                <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${item.available <= 0 ? 'text-red-600 font-medium' : item.available <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                                  {item.available.toLocaleString()}
                                </td>
                                <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${item.committed > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                                  {item.committed.toLocaleString()}
                                </td>
                                <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${item.incoming > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                                  {item.incoming.toLocaleString()}
                                </td>
                              </tr>
                            ))
                          ) : (
                            // All Locations View
                            filteredInventory.map((item, index) => (
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
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {((inventoryLocationFilter && filteredLocationDetail.length === 0) || (!inventoryLocationFilter && filteredInventory.length === 0)) && 
                      <div className="p-8 text-center text-gray-500">No inventory items match your filters.</div>}
                  </div>
                )}

                {/* Grouped View */}
                {inventoryViewMode === 'grouped' && (
                  <div className="space-y-4">
                    {inventoryLocationFilter ? (
                      // Location Detail Grouped View
                      (() => {
                        const groupedLocationItems = filteredLocationDetail.reduce((groups, item) => {
                          const model = extractProductModel(item.productTitle, item.sku);
                          if (!groups[model]) groups[model] = [];
                          groups[model].push(item);
                          return groups;
                        }, {} as Record<string, typeof filteredLocationDetail>);
                        const sortedLocationGroupNames = Object.keys(groupedLocationItems).sort((a, b) => getModelPriority(b) - getModelPriority(a));
                        
                        if (sortedLocationGroupNames.length === 0) {
                          return <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">No inventory items match your filters.</div>;
                        }
                        
                        return sortedLocationGroupNames.map(groupName => {
                          const shouldReverseSort = groupName === 'Screen Protectors' || groupName === 'Lens Protectors';
                          const items = [...groupedLocationItems[groupName]].sort((a, b) => 
                            shouldReverseSort ? b.sku.localeCompare(a.sku) : a.sku.localeCompare(b.sku)
                          );
                          const groupTotal = items.reduce((sum, item) => sum + item.available, 0);
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
                                      <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">On Hand</th>
                                      <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Available</th>
                                      <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Committed</th>
                                      <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Incoming</th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {items.map((item, index) => (
                                      <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                        <td className="w-32 px-3 sm:px-4 py-2 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis"
                                          title={`${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`}>{item.sku}</td>
                                        <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.onHand <= 0 ? 'text-red-600 font-medium' : item.onHand <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                                          {item.onHand.toLocaleString()}
                                        </td>
                                        <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.available <= 0 ? 'text-red-600 font-medium' : item.available <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                                          {item.available.toLocaleString()}
                                        </td>
                                        <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.committed > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                                          {item.committed.toLocaleString()}
                                        </td>
                                        <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.incoming > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                                          {item.incoming.toLocaleString()}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        });
                      })()
                    ) : (
                      // All Locations Grouped View
                      <>
                        {sortedGroupNames.length === 0 && (
                          <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">No inventory items match your filters.</div>
                        )}
                        {sortedGroupNames.map(groupName => {
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
                                      <th className="w-32 px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('sku')}>
                                        SKU <SortIcon active={sortBy === 'sku'} order={sortOrder} />
                                      </th>
                                      {inventoryData.locations.map(location => (
                                        <th key={location} className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                                          onClick={() => handleSort(location)}>
                                          {location} <SortIcon active={sortBy === location} order={sortOrder} />
                                        </th>
                                      ))}
                                      <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('total')}>
                                        Total <SortIcon active={sortBy === 'total'} order={sortOrder} />
                                      </th>
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
                      </>
                    )}
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
                  
                  // Get inbound air to LA Office
                  const getLAInboundAir = (sku: string): number => {
                    const laDetails = inventoryData.locationDetails?.['LA Office'];
                    if (!laDetails) return 0;
                    const detail = laDetails.find(d => d.sku === sku);
                    return detail?.inboundAir || 0;
                  };
                  
                  // Get inbound sea to LA Office
                  const getLAInboundSea = (sku: string): number => {
                    const laDetails = inventoryData.locationDetails?.['LA Office'];
                    if (!laDetails) return 0;
                    const detail = laDetails.find(d => d.sku === sku);
                    return detail?.inboundSea || 0;
                  };
                  
                  // Get total incoming to LA Office (air + sea)
                  const getLAIncoming = (sku: string): number => {
                    return getLAInboundAir(sku) + getLAInboundSea(sku);
                  };
                  
                  // Get transfer notes for LA Office
                  const getLATransferNotes = (sku: string): Array<{ id: string; note: string | null }> => {
                    const laDetails = inventoryData.locationDetails?.['LA Office'];
                    if (!laDetails) return [];
                    const detail = laDetails.find(d => d.sku === sku);
                    return detail?.transferNotes || [];
                  };
                  
                  // Get committed from LA (LA Office + DTLA WH)
                  const getLACommitted = (sku: string): number => {
                    const laOfficeDetails = inventoryData.locationDetails?.['LA Office'];
                    const dtlaDetails = inventoryData.locationDetails?.['DTLA WH'];
                    let committed = 0;
                    if (laOfficeDetails) {
                      const detail = laOfficeDetails.find(d => d.sku === sku);
                      committed += detail?.committed || 0;
                    }
                    if (dtlaDetails) {
                      const detail = dtlaDetails.find(d => d.sku === sku);
                      committed += detail?.committed || 0;
                    }
                    return committed;
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
                      case 'Phase Out': return 'bg-gray-200 text-gray-500';
                      default: return 'bg-gray-100 text-gray-800';
                    }
                  };
                  
                  // Get prod status color
                  const getProdStatusColor = (prodStatus: string): string => {
                    switch (prodStatus) {
                      case 'Push Vendor': return 'bg-red-100 text-red-800';
                      case 'Order More': return 'bg-orange-100 text-orange-800';
                      case 'Get Prod Status': return 'bg-yellow-100 text-yellow-800';
                      case 'More in Prod': return 'bg-purple-100 text-purple-800';
                      case 'No Action': return 'bg-green-100 text-green-800';
                      case 'Phase Out': return 'bg-gray-200 text-gray-500';
                      default: return 'bg-gray-100 text-gray-800';
                    }
                  };
                  
                  // Ship type sort order (most urgent first, Phase Out last)
                  const shipTypePriority: Record<string, number> = {
                    'Express': 1,
                    'No CN Inv': 2,
                    'Slow Air': 3,
                    'Sea': 4,
                    'No Action': 5,
                    'Phase Out': 99,
                  };
                  
                  // Prod status sort order (most urgent first, Phase Out last)
                  const prodStatusPriority: Record<string, number> = {
                    'Push Vendor': 1,
                    'Order More': 2,
                    'Get Prod Status': 3,
                    'More in Prod': 4,
                    'No Action': 5,
                    'Phase Out': 99,
                  };
                  
                  // Build all planning items (for metrics calculation)
                  const allPlanningItems = inventoryData.inventory
                    .map(inv => {
                      const laInventory = getLAInventory(inv.sku);
                      const laCommitted = getLACommitted(inv.sku);
                      const inboundAir = getLAInboundAir(inv.sku);
                      const inboundSea = getLAInboundSea(inv.sku);
                      const incoming = inboundAir + inboundSea;
                      const transferNotes = getLATransferNotes(inv.sku);
                      const chinaInventory = getChinaInventory(inv.sku);
                      const poQty = getPOQuantity(inv.sku);
                      const unitsPerDay = getUnitsPerDay(inv.sku);
                      
                      // Check if SKU is in phase out list
                      const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === inv.sku.toLowerCase());
                      
                      // Calculate total inventory across all warehouses (LA + China + Incoming + In Production)
                      const totalInventory = laInventory + chinaInventory + incoming + poQty;
                      
                      // If phase out with no inventory anywhere, mark for filtering
                      if (isPhaseOut && totalInventory <= 0) {
                        return null; // Will be filtered out
                      }
                      
                      // For phase out SKUs, override ship type and prod status
                      const shipType = isPhaseOut ? 'Phase Out' : getShipType(laInventory, incoming, chinaInventory, unitsPerDay);
                      
                      // Calculate Runway Air (days of LA + Inbound Air only)
                      const runwayAir = unitsPerDay > 0 ? Math.round((laInventory + inboundAir) / unitsPerDay) : 999;
                      
                      // Calculate Runway (days of LA + Inbound Air + Inbound Sea)
                      const runway = unitsPerDay > 0 ? Math.round((laInventory + inboundAir + inboundSea) / unitsPerDay) : 999;
                      
                      // Calculate LA Need: units needed to cover target days minus (LA qty - committed)
                      const laNeeded = Math.max(0, Math.ceil((planningLaTargetDays * unitsPerDay) - (laInventory - laCommitted)));
                      
                      // Determine prod status based on runway and PO (or Phase Out if applicable)
                      let prodStatus: string;
                      if (isPhaseOut) {
                        prodStatus = 'Phase Out';
                      } else {
                        const hasPO = poQty > 0;
                        if (runway > 90) {
                          prodStatus = hasPO ? 'More in Prod' : 'No Action';
                        } else if (runway > 60) {
                          prodStatus = hasPO ? 'Get Prod Status' : 'No Action';
                        } else {
                          prodStatus = hasPO ? 'Push Vendor' : 'Order More';
                        }
                      }
                      
                      return {
                        sku: inv.sku,
                        productTitle: inv.productTitle,
                        la: laInventory,
                        inboundAir,
                        inboundSea,
                        transferNotes,
                        china: chinaInventory,
                        poQty,
                        unitsPerDay,
                        laNeed: laNeeded,
                        shipType,
                        runwayAir,
                        runway,
                        prodStatus,
                      };
                    })
                    .filter((item): item is NonNullable<typeof item> => item !== null);
                  
                  // Calculate metrics from all items (before filtering)
                  const planningMetrics = {
                    sea: allPlanningItems.filter(item => item.shipType === 'Sea').length,
                    slowAir: allPlanningItems.filter(item => item.shipType === 'Slow Air').length,
                    express: allPlanningItems.filter(item => item.shipType === 'Express').length,
                    orderMore: allPlanningItems.filter(item => item.prodStatus === 'Order More').length,
                  };
                  
                  // Filter and sort planning items for display
                  const planningItems = allPlanningItems
                    .filter(item => {
                      // Filter by search term
                      const matchesSearch = !planningSearchTerm || 
                        item.sku.toLowerCase().includes(planningSearchTerm.toLowerCase()) ||
                        item.productTitle.toLowerCase().includes(planningSearchTerm.toLowerCase());
                      // Filter by ship type
                      const matchesShipType = planningFilterShipType === 'all' || item.shipType === planningFilterShipType;
                      // Filter by prod status
                      const matchesProdStatus = planningFilterProdStatus === 'all' || item.prodStatus === planningFilterProdStatus;
                      return matchesSearch && matchesShipType && matchesProdStatus;
                    })
                    .sort((a, b) => {
                      let comparison = 0;
                      switch (planningSortBy) {
                        case 'sku': comparison = a.sku.localeCompare(b.sku); break;
                        case 'la': comparison = a.la - b.la; break;
                        case 'inboundAir': comparison = a.inboundAir - b.inboundAir; break;
                        case 'inboundSea': comparison = a.inboundSea - b.inboundSea; break;
                        case 'china': comparison = a.china - b.china; break;
                        case 'poQty': comparison = a.poQty - b.poQty; break;
                        case 'unitsPerDay': comparison = a.unitsPerDay - b.unitsPerDay; break;
                        case 'laNeed': comparison = a.laNeed - b.laNeed; break;
                        case 'shipType': comparison = (shipTypePriority[a.shipType] || 99) - (shipTypePriority[b.shipType] || 99); break;
                        case 'runwayAir': comparison = a.runwayAir - b.runwayAir; break;
                        case 'prodStatus': comparison = (prodStatusPriority[a.prodStatus] || 99) - (prodStatusPriority[b.prodStatus] || 99); break;
                        case 'runway': comparison = a.runway - b.runway; break;
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
                  
                  // Helper to get runout date from runway days
                  const getRunoutDate = (runwayDays: number): string => {
                    if (runwayDays >= 999) return 'No sales data';
                    if (runwayDays <= 0) return 'Out of Stock';
                    const runoutDate = new Date();
                    runoutDate.setDate(runoutDate.getDate() + runwayDays);
                    return runoutDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
                            <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('inboundAir')}>
                              In Air <SortIcon active={planningSortBy === 'inboundAir'} order={planningSortOrder} />
                            </th>
                            <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('inboundSea')}>
                              In Sea <SortIcon active={planningSortBy === 'inboundSea'} order={planningSortOrder} />
                            </th>
                            <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('china')}>
                              China <SortIcon active={planningSortBy === 'china'} order={planningSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('poQty')}>
                              In Prod <SortIcon active={planningSortBy === 'poQty'} order={planningSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('unitsPerDay')}>
                              Units/Day <SortIcon active={planningSortBy === 'unitsPerDay'} order={planningSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('laNeed')}>
                              LA Need <SortIcon active={planningSortBy === 'laNeed'} order={planningSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('shipType')}>
                              Ship Type <SortIcon active={planningSortBy === 'shipType'} order={planningSortOrder} />
                            </th>
                            <th className="w-28 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('prodStatus')}>
                              Prod Status <SortIcon active={planningSortBy === 'prodStatus'} order={planningSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('runwayAir')}>
                              Runway Air <SortIcon active={planningSortBy === 'runwayAir'} order={planningSortOrder} />
                            </th>
                            <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('runway')}>
                              Runway <SortIcon active={planningSortBy === 'runway'} order={planningSortOrder} />
                            </th>
                          </tr>
                        </thead>
                      )}
                      <tbody className="bg-white divide-y divide-gray-200">
                        {items.map((item, index) => (
                          <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="w-32 px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={item.productTitle}>{item.sku}</td>
                            <td className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.la <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{item.la.toLocaleString()}</td>
                            <td 
                              className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.inboundAir > 0 ? 'text-purple-600 font-medium cursor-help' : 'text-gray-400'}`}
                              title={item.transferNotes.filter(t => t.note).map(t => `${t.id}: ${t.note}`).join('\n') || undefined}
                            >
                              {item.inboundAir > 0 ? item.inboundAir.toLocaleString() : '—'}
                            </td>
                            <td 
                              className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.inboundSea > 0 ? 'text-blue-600 font-medium cursor-help' : 'text-gray-400'}`}
                              title={item.transferNotes.filter(t => t.note).map(t => `${t.id}: ${t.note}`).join('\n') || undefined}
                            >
                              {item.inboundSea > 0 ? item.inboundSea.toLocaleString() : '—'}
                            </td>
                            <td className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.china <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{item.china.toLocaleString()}</td>
                            <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${item.poQty > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{item.poQty > 0 ? item.poQty.toLocaleString() : '—'}</td>
                            <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.unitsPerDay.toFixed(1)}</td>
                            <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${item.laNeed > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
                              {item.laNeed > 0 ? item.laNeed.toLocaleString() : '—'}
                            </td>
                            <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getShipTypeColor(item.shipType)}`}>
                                {item.shipType}
                              </span>
                            </td>
                            <td className="w-28 px-3 sm:px-4 py-3 text-sm text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getProdStatusColor(item.prodStatus)}`}>
                                {item.prodStatus}
                              </span>
                            </td>
                            <td 
                              className={`w-24 px-3 sm:px-4 py-3 text-sm text-center cursor-help ${item.runwayAir < 60 ? 'text-red-600 font-medium' : item.runwayAir < 90 ? 'text-orange-600' : 'text-gray-900'}`}
                              title={`Runs out: ${getRunoutDate(item.runwayAir)}`}
                            >
                              {item.runwayAir >= 999 ? '∞' : `${item.runwayAir}d`}
                            </td>
                            <td 
                              className={`w-24 px-3 sm:px-4 py-3 text-sm text-center cursor-help ${item.runway < 60 ? 'text-red-600 font-medium' : item.runway < 90 ? 'text-orange-600' : 'text-gray-900'}`}
                              title={`Runs out: ${getRunoutDate(item.runway)}`}
                            >
                              {item.runway >= 999 ? '∞' : `${item.runway}d`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                  
                  return (
                    <>
                      {/* Metrics Section */}
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                        <button 
                          onClick={() => {
                            setPlanningFilterProdStatus('all');
                            setPlanningFilterShipType(planningFilterShipType === 'Sea' ? 'all' : 'Sea');
                          }}
                          className={`text-center bg-white shadow rounded-lg p-3 sm:p-4 border-2 transition-all cursor-pointer hover:border-green-300 ${planningFilterShipType === 'Sea' ? 'border-green-500' : 'border-transparent'}`}
                        >
                          <p className="text-xs sm:text-sm font-medium text-gray-500">Sea</p>
                          <p className="text-lg sm:text-xl font-bold text-green-600">{planningMetrics.sea}</p>
                        </button>
                        <button 
                          onClick={() => {
                            setPlanningFilterProdStatus('all');
                            setPlanningFilterShipType(planningFilterShipType === 'Slow Air' ? 'all' : 'Slow Air');
                          }}
                          className={`text-center bg-white shadow rounded-lg p-3 sm:p-4 border-2 transition-all cursor-pointer hover:border-blue-300 ${planningFilterShipType === 'Slow Air' ? 'border-blue-500' : 'border-transparent'}`}
                        >
                          <p className="text-xs sm:text-sm font-medium text-gray-500">Slow Air</p>
                          <p className="text-lg sm:text-xl font-bold text-blue-600">{planningMetrics.slowAir}</p>
                        </button>
                        <button 
                          onClick={() => {
                            setPlanningFilterProdStatus('all');
                            setPlanningFilterShipType(planningFilterShipType === 'Express' ? 'all' : 'Express');
                          }}
                          className={`text-center bg-white shadow rounded-lg p-3 sm:p-4 border-2 transition-all cursor-pointer hover:border-orange-300 ${planningFilterShipType === 'Express' ? 'border-orange-500' : 'border-transparent'}`}
                        >
                          <p className="text-xs sm:text-sm font-medium text-gray-500">Express</p>
                          <p className="text-lg sm:text-xl font-bold text-orange-600">{planningMetrics.express}</p>
                        </button>
                        <button 
                          onClick={() => {
                            setPlanningFilterShipType('all');
                            setPlanningFilterProdStatus(planningFilterProdStatus === 'Order More' ? 'all' : 'Order More');
                          }}
                          className={`text-center bg-white shadow rounded-lg p-3 sm:p-4 border-2 transition-all cursor-pointer hover:border-red-300 ${planningFilterProdStatus === 'Order More' ? 'border-red-500' : 'border-transparent'}`}
                        >
                          <p className="text-xs sm:text-sm font-medium text-gray-500">Order More</p>
                          <p className="text-lg sm:text-xl font-bold text-red-600">{planningMetrics.orderMore}</p>
                        </button>
                      </div>

                      {/* Filter Bar */}
                      <div className="bg-white shadow rounded-lg p-4 sm:p-6">
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                          <div className="flex gap-3 flex-wrap items-end">
                            <div className="flex flex-col">
                              <span className="text-[10px] text-gray-400 mb-1">Ship Type</span>
                              <select 
                                value={planningFilterShipType} 
                                onChange={(e) => setPlanningFilterShipType(e.target.value)}
                                className="h-[34px] px-3 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="all">All Ship Types</option>
                                <option value="Sea">Sea</option>
                                <option value="Slow Air">Slow Air</option>
                                <option value="Express">Express</option>
                                <option value="Order More">Order More</option>
                              </select>
                            </div>
                            {/* List/Grouped Toggle */}
                            <div className="flex flex-col">
                              <span className="text-[10px] text-gray-400 mb-1">View</span>
                              <div className="flex items-center h-[34px] bg-gray-100 p-1 rounded-lg">
                                <button onClick={() => setPlanningListMode('list')}
                                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${planningListMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                  List
                                </button>
                                <button onClick={() => setPlanningListMode('grouped')}
                                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${planningListMode === 'grouped' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                  Grouped
                                </button>
                              </div>
                            </div>
                            {/* Burn Rate Period Dropdown */}
                            <div className="flex flex-col">
                              <span className="text-[10px] text-gray-400 mb-1">Burn Rate Period</span>
                              <select
                                value={planningBurnPeriod}
                                onChange={(e) => setPlanningBurnPeriod(e.target.value as '7d' | '21d' | '90d')}
                                className="h-[34px] px-3 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="7d">7 Days</option>
                                <option value="21d">21 Days</option>
                                <option value="90d">90 Days</option>
                              </select>
                            </div>
                            {/* LA Target Days */}
                            <div className="flex flex-col">
                              <span className="text-[10px] text-gray-400 mb-1">Units needed in LA for</span>
                              <select
                                value={planningLaTargetDays}
                                onChange={(e) => setPlanningLaTargetDays(Number(e.target.value))}
                                className="h-[34px] px-3 text-xs border border-gray-300 rounded-lg bg-white"
                              >
                                <option value={14}>14 days</option>
                                <option value={30}>30 days</option>
                                <option value={60}>60 days</option>
                                <option value={90}>90 days</option>
                                <option value={120}>120 days</option>
                                <option value={180}>180 days</option>
                              </select>
                            </div>
                          </div>
                          <input type="text" placeholder="Search by SKU or product..." value={planningSearchTerm} onChange={(e) => setPlanningSearchTerm(e.target.value)}
                            className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                      </div>

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
                                        <th className="w-20 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">In Air</th>
                                        <th className="w-20 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">In Sea</th>
                                        <th className="w-20 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">China</th>
                                        <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">In Prod</th>
                                        <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Units/Day</th>
                                        <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">LA Need</th>
                                        <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Ship Type</th>
                                        <th className="w-28 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Prod Status</th>
                                        <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Runway Air</th>
                                        <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Runway</th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                      {sortedItems.map((item, index) => (
                                        <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                          <td className="w-32 px-3 sm:px-4 py-2 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={item.productTitle}>{item.sku}</td>
                                          <td className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${item.la <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{item.la.toLocaleString()}</td>
                                          <td 
                                            className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${item.inboundAir > 0 ? 'text-purple-600 font-medium cursor-help' : 'text-gray-400'}`}
                                            title={item.transferNotes.filter(t => t.note).map(t => `${t.id}: ${t.note}`).join('\n') || undefined}
                                          >
                                            {item.inboundAir > 0 ? item.inboundAir.toLocaleString() : '—'}
                                          </td>
                                          <td 
                                            className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${item.inboundSea > 0 ? 'text-blue-600 font-medium cursor-help' : 'text-gray-400'}`}
                                            title={item.transferNotes.filter(t => t.note).map(t => `${t.id}: ${t.note}`).join('\n') || undefined}
                                          >
                                            {item.inboundSea > 0 ? item.inboundSea.toLocaleString() : '—'}
                                          </td>
                                          <td className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${item.china <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{item.china.toLocaleString()}</td>
                                          <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.poQty > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{item.poQty > 0 ? item.poQty.toLocaleString() : '—'}</td>
                                          <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{item.unitsPerDay.toFixed(1)}</td>
                                          <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.laNeed > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
                                            {item.laNeed > 0 ? item.laNeed.toLocaleString() : '—'}
                                          </td>
                                          <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getShipTypeColor(item.shipType)}`}>
                                              {item.shipType}
                                            </span>
                                          </td>
                                          <td className="w-28 px-3 sm:px-4 py-2 text-sm text-center">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getProdStatusColor(item.prodStatus)}`}>
                                              {item.prodStatus}
                                            </span>
                                          </td>
                                          <td 
                                            className={`w-24 px-3 sm:px-4 py-2 text-sm text-center cursor-help ${item.runwayAir < 60 ? 'text-red-600 font-medium' : item.runwayAir < 90 ? 'text-orange-600' : 'text-gray-900'}`}
                                            title={`Runs out: ${getRunoutDate(item.runwayAir)}`}
                                          >
                                            {item.runwayAir >= 999 ? '∞' : `${item.runwayAir}d`}
                                          </td>
                                          <td 
                                            className={`w-24 px-3 sm:px-4 py-2 text-sm text-center cursor-help ${item.runway < 60 ? 'text-red-600 font-medium' : item.runway < 90 ? 'text-orange-600' : 'text-gray-900'}`}
                                            title={`Runs out: ${getRunoutDate(item.runway)}`}
                                          >
                                            {item.runway >= 999 ? '∞' : `${item.runway}d`}
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

                      {/* Export Button */}
                      <div className="mt-6 flex justify-center">
                        <button
                          onClick={() => {
                            // Build CSV content
                            const headers = ['SKU', 'Product', 'LA', 'In Air', 'In Sea', 'China', 'In Prod', 'Units/Day', 'LA Need', 'Ship Type', 'Prod Status', 'Runway Air', 'Runway', 'Transfer Notes'];
                            const rows = planningItems.map(item => [
                              item.sku,
                              `"${item.productTitle.replace(/"/g, '""')}"`,
                              item.la,
                              item.inboundAir,
                              item.inboundSea,
                              item.china,
                              item.poQty,
                              item.unitsPerDay.toFixed(1),
                              item.laNeed,
                              item.shipType,
                              item.prodStatus,
                              item.runwayAir >= 999 ? 'N/A' : `${item.runwayAir}d`,
                              item.runway >= 999 ? 'N/A' : `${item.runway}d`,
                              `"${item.transferNotes.filter(t => t.note).map(t => `${t.id}: ${t.note}`).join('; ').replace(/"/g, '""')}"`
                            ]);
                            
                            const csvContent = [
                              headers.join(','),
                              ...rows.map(row => row.join(','))
                            ].join('\n');
                            
                            // Create and download file
                            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                            const link = document.createElement('a');
                            const url = URL.createObjectURL(blob);
                            link.setAttribute('href', url);
                            link.setAttribute('download', `planning-export-${new Date().toISOString().split('T')[0]}.csv`);
                            link.style.visibility = 'hidden';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          className="px-6 py-3 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                        >
                          <span>📥</span> Export to Excel
                        </button>
                      </div>
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
            <div className="flex flex-col gap-4">
              {/* Top Row: Status Filter + New Order Button */}
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
              
              {/* SKU Search Row */}
              <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 whitespace-nowrap">Search SKU:</label>
                  <input
                    type="text"
                    value={skuSearchQuery}
                    onChange={(e) => setSkuSearchQuery(e.target.value.toUpperCase())}
                    placeholder="e.g. EC-IP17PM"
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-36 font-mono"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 whitespace-nowrap">From:</label>
                  <input
                    type="date"
                    value={skuSearchDateFrom}
                    onChange={(e) => setSkuSearchDateFrom(e.target.value)}
                    className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 whitespace-nowrap">To:</label>
                  <input
                    type="date"
                    value={skuSearchDateTo}
                    onChange={(e) => setSkuSearchDateTo(e.target.value)}
                    className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                {(skuSearchQuery || skuSearchDateFrom || skuSearchDateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSkuSearchQuery('');
                      setSkuSearchDateFrom('');
                      setSkuSearchDateTo('');
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Orders List */}
            {productionOrdersLoading ? (
              <div className="bg-white shadow rounded-lg p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-2 text-gray-600">Loading orders...</p>
              </div>
            ) : (() => {
              // Apply all filters
              const filteredOrders = productionOrders.filter(order => {
                // Status filter
                if (productionFilterStatus === 'open' && !['in_production', 'partial'].includes(order.status)) return false;
                if (productionFilterStatus === 'completed' && !['completed', 'cancelled'].includes(order.status)) return false;
                
                // SKU search filter
                if (skuSearchQuery) {
                  const hasMatchingSku = order.items.some(item => 
                    item.sku.toUpperCase().includes(skuSearchQuery.toUpperCase())
                  );
                  if (!hasMatchingSku) return false;
                }
                
                // Date range filter (based on createdAt)
                if (skuSearchDateFrom) {
                  const orderDate = new Date(order.createdAt);
                  const fromDate = new Date(skuSearchDateFrom);
                  fromDate.setHours(0, 0, 0, 0);
                  if (orderDate < fromDate) return false;
                }
                if (skuSearchDateTo) {
                  const orderDate = new Date(order.createdAt);
                  const toDate = new Date(skuSearchDateTo);
                  toDate.setHours(23, 59, 59, 999);
                  if (orderDate > toDate) return false;
                }
                
                return true;
              });

              // Calculate SKU-specific stats when searching
              let skuStats: { totalOrdered: number; totalReceived: number; poCount: number } | null = null;
              if (skuSearchQuery) {
                const searchTerm = skuSearchQuery.toUpperCase();
                let totalOrdered = 0;
                let totalReceived = 0;
                const poSet = new Set<string>();
                
                filteredOrders.forEach(order => {
                  order.items.forEach(item => {
                    if (item.sku.toUpperCase().includes(searchTerm)) {
                      totalOrdered += item.quantity;
                      totalReceived += item.receivedQuantity || 0;
                      poSet.add(order.id);
                    }
                  });
                });
                
                skuStats = { totalOrdered, totalReceived, poCount: poSet.size };
              }

              return (
                <>
                  {/* SKU Search Summary */}
                  {skuStats && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-6">
                          <div>
                            <span className="text-sm text-blue-600">SKU Search:</span>
                            <span className="ml-2 font-mono font-medium text-blue-900">{skuSearchQuery}</span>
                          </div>
                          <div className="h-8 w-px bg-blue-200"></div>
                          <div className="text-sm">
                            <span className="text-blue-600">POs Found:</span>
                            <span className="ml-2 font-semibold text-blue-900">{skuStats.poCount}</span>
                          </div>
                          <div className="text-sm">
                            <span className="text-blue-600">Total Ordered:</span>
                            <span className="ml-2 font-semibold text-blue-900">{skuStats.totalOrdered.toLocaleString()}</span>
                          </div>
                          <div className="text-sm">
                            <span className="text-blue-600">Total Delivered:</span>
                            <span className="ml-2 font-semibold text-green-700">{skuStats.totalReceived.toLocaleString()}</span>
                          </div>
                          <div className="text-sm">
                            <span className="text-blue-600">Pending:</span>
                            <span className="ml-2 font-semibold text-orange-600">{(skuStats.totalOrdered - skuStats.totalReceived).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
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
                        {filteredOrders.map((order) => {
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
                                    {/* Activity Log */}
                                    {order.activityLog && order.activityLog.length > 0 && (
                                      <div>
                                        <details className="group">
                                          <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700 flex items-center gap-1">
                                            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                            Activity Log ({order.activityLog.length})
                                          </summary>
                                          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                                            {[...order.activityLog].reverse().map((entry, idx) => (
                                              <div key={idx} className="text-xs text-gray-500 bg-white p-2 rounded border border-gray-100">
                                                <div className="flex justify-between items-start gap-2">
                                                  <span className="font-medium text-gray-700">{entry.action}</span>
                                                  <span className="text-gray-400 whitespace-nowrap">
                                                    {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                  </span>
                                                </div>
                                                {entry.details && (
                                                  <div className="text-gray-500 mt-0.5">{entry.details}</div>
                                                )}
                                                <div className="text-gray-400 mt-0.5">by {entry.changedBy}</div>
                                              </div>
                                            ))}
                                          </div>
                                        </details>
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
                        {filteredOrders.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                              {skuSearchQuery || skuSearchDateFrom || skuSearchDateTo
                                ? 'No orders match your search criteria.'
                                : 'No orders found. Click "New Production Order" to create one.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}

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
                      disabled={isCreatingOrder}
                      className={`px-4 py-2 rounded-md text-sm font-medium ${
                        isCreatingOrder 
                          ? 'bg-blue-400 text-white cursor-not-allowed' 
                          : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
                      }`}
                    >
                      {isCreatingOrder ? 'Creating...' : 'Create Order'}
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
                      disabled={isLoggingDelivery}
                      className={`px-4 py-2 rounded-md text-sm font-medium ${
                        isLoggingDelivery
                          ? 'bg-green-400 text-white cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                      }`}
                    >
                      {isLoggingDelivery ? 'Saving...' : 'Confirm Delivery'}
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
                      disabled={isSavingOrder}
                      className={`px-4 py-2 rounded-md text-sm font-medium ${
                        isSavingOrder
                          ? 'bg-blue-400 text-white cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
                      }`}
                    >
                      {isSavingOrder ? 'Saving...' : 'Save Changes'}
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
                      disabled={isCancellingOrder}
                      className={`px-4 py-2 rounded-md text-sm font-medium ${
                        isCancellingOrder
                          ? 'bg-red-400 text-white cursor-not-allowed'
                          : 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800'
                      }`}
                    >
                      {isCancellingOrder ? 'Cancelling...' : 'Yes, Cancel Order'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Phase Out Modal */}
        {showPhaseOutModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Phase Out SKUs</h3>
                <p className="text-sm text-gray-500 mt-1">SKUs being phased out won&apos;t require production planning</p>
              </div>
              <div className="px-6 py-4 flex-1 overflow-y-auto">
                {/* Add new SKU with autocomplete */}
                <div className="mb-4">
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={newPhaseOutSku}
                        onChange={(e) => setNewPhaseOutSku(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && addPhaseOutSku()}
                        placeholder="Enter SKU..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                      {/* SKU Suggestions Dropdown */}
                      {newPhaseOutSku.length >= 2 && inventoryData?.inventory && (() => {
                        const suggestions = inventoryData.inventory
                          .filter(inv => 
                            inv.sku.toUpperCase().includes(newPhaseOutSku) &&
                            !phaseOutSkus.some(s => s.toLowerCase() === inv.sku.toLowerCase())
                          )
                          .slice(0, 8);
                        
                        if (suggestions.length === 0) return null;
                        
                        return (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                            {suggestions.map((inv) => (
                              <button
                                key={inv.sku}
                                onClick={() => {
                                  setNewPhaseOutSku(inv.sku);
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 border-b border-gray-100 last:border-b-0"
                              >
                                <span className="font-medium">{inv.sku}</span>
                                <span className="text-gray-500 ml-2 text-xs">{inv.productTitle}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <button
                      onClick={addPhaseOutSku}
                      disabled={isAddingPhaseOut || !newPhaseOutSku.trim()}
                      className={`px-4 py-2 text-sm font-medium rounded-md ${
                        isAddingPhaseOut || !newPhaseOutSku.trim()
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {isAddingPhaseOut ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </div>

                {/* List of phase out SKUs */}
                {phaseOutSkus.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No SKUs in phase out list</p>
                ) : (
                  <div className="space-y-2">
                    {[...phaseOutSkus].sort((a, b) => a.localeCompare(b)).map((sku) => (
                      <div key={sku} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-md">
                        <span className="text-sm font-medium text-gray-900">{sku}</span>
                        <button
                          onClick={() => removePhaseOutSku(sku)}
                          disabled={isRemovingPhaseOut === sku}
                          className={`text-xs ${
                            isRemovingPhaseOut === sku
                              ? 'text-gray-400 cursor-not-allowed'
                              : 'text-red-600 hover:text-red-800 hover:underline'
                          }`}
                        >
                          {isRemovingPhaseOut === sku ? 'Removing...' : 'Remove'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={() => setShowPhaseOutModal(false)}
                  className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
