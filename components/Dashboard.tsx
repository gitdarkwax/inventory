'use client';

/**
 * Inventory Dashboard Component
 * Displays inventory levels and forecasting data
 */

import { useState, useEffect } from 'react';
import { signOut } from 'next-auth/react';

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

interface DashboardProps {
  session: {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  };
}

type TabType = 'inventory' | 'forecasting';

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
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [locationSearchTerm, setLocationSearchTerm] = useState('');
  const [locationSortBy, setLocationSortBy] = useState<'sku' | 'onHand' | 'available' | 'committed' | 'incoming'>('sku');
  const [locationSortOrder, setLocationSortOrder] = useState<'asc' | 'desc'>('asc');

  // Forecasting state
  const [forecastingData, setForecastingData] = useState<ForecastingData | null>(null);
  const [forecastingLoading, setForecastingLoading] = useState(false);
  const [forecastingError, setForecastingError] = useState<string | null>(null);
  const [forecastSearchTerm, setForecastSearchTerm] = useState('');
  const [forecastSortBy, setForecastSortBy] = useState<'sku' | 'avgDaily7d' | 'avgDaily21d' | 'avgDaily90d' | 'avgDailyLastYear30d'>('avgDaily7d');
  const [forecastSortOrder, setForecastSortOrder] = useState<'asc' | 'desc'>('desc');
  const [forecastViewMode, setForecastViewMode] = useState<'velocity' | 'daysLeft'>('velocity');

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cacheAge, setCacheAge] = useState<string | null>(null);

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
      if (data.cache?.age) {
        setCacheAge(data.cache.age);
      }
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
    }
  }, [activeTab]);

  // Initial load from cache
  useEffect(() => {
    loadInventoryFromCache();
  }, []);

  // Merge forecasting with inventory for days of stock calculation
  const mergedForecastingData = forecastingData?.forecasting.map(item => {
    const inventoryItem = inventoryData?.inventory.find(inv => inv.sku === item.sku);
    const totalInventory = inventoryItem?.totalAvailable || 0;
    const avgDaily = item.avgDaily21d; // Use 21-day average for days of stock
    const daysOfStock = avgDaily > 0 ? totalInventory / avgDaily : totalInventory > 0 ? 999 : 0;
    return {
      ...item,
      totalInventory,
      daysOfStock,
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
        .filter(item => !locationSearchTerm || 
          item.sku.toLowerCase().includes(locationSearchTerm.toLowerCase()) ||
          item.productTitle.toLowerCase().includes(locationSearchTerm.toLowerCase()))
        .sort((a, b) => {
          let comparison = 0;
          if (locationSortBy === 'sku') comparison = a.sku.localeCompare(b.sku);
          else comparison = a[locationSortBy] - b[locationSortBy];
          return locationSortOrder === 'asc' ? comparison : -comparison;
        })
    : [];

  // Filter and sort forecasting
  const filteredForecasting = mergedForecastingData
    .filter(item => !forecastSearchTerm || 
      item.sku.toLowerCase().includes(forecastSearchTerm.toLowerCase()) ||
      item.productName.toLowerCase().includes(forecastSearchTerm.toLowerCase()))
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

  // Get color class for days of stock
  const getDaysColor = (days: number): string => {
    if (days <= 0) return 'text-red-600 font-medium';
    if (days <= 14) return 'text-red-600';
    if (days <= 30) return 'text-orange-600';
    if (days >= 999) return 'text-gray-400';
    return 'text-green-600';
  };

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
            <input type="text" placeholder="Search by SKU or product name..." value={locationSearchTerm} onChange={(e) => setLocationSearchTerm(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-500 mt-2">Showing {locationData.length} SKUs</p>
          </div>

          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('sku')}>
                      SKU <SortIcon active={locationSortBy === 'sku'} order={locationSortOrder} />
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('onHand')}>
                      On Hand <SortIcon active={locationSortBy === 'onHand'} order={locationSortOrder} />
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('available')}>
                      Available <SortIcon active={locationSortBy === 'available'} order={locationSortOrder} />
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('committed')}>
                      Committed <SortIcon active={locationSortBy === 'committed'} order={locationSortOrder} />
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('incoming')}>
                      Incoming <SortIcon active={locationSortBy === 'incoming'} order={locationSortOrder} />
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {locationData.map((item, index) => (
                    <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap" title={`${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`}>{item.sku}</td>
                      <td className="px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.onHand.toLocaleString()}</td>
                      <td className={`px-3 sm:px-4 py-3 text-sm text-center ${item.available <= 0 ? 'text-red-600 font-medium' : item.available <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>{item.available.toLocaleString()}</td>
                      <td className="px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.committed.toLocaleString()}</td>
                      <td className={`px-3 sm:px-4 py-3 text-sm text-center ${item.incoming > 0 ? 'text-purple-600 font-medium' : 'text-gray-900'}`}>{item.incoming.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
                  Last refreshed: {new Date(inventoryData.lastUpdated).toLocaleString()}
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
                    <input type="text" placeholder="Search by SKU or product name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                      className="flex-1 max-w-md px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <div className="flex gap-2 flex-wrap">
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
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <p className="text-xs text-gray-500">Showing {filteredInventory.length} of {inventoryData.totalSKUs} SKUs</p>
                    {cacheAge && <p className="text-xs text-gray-400">Last updated: {cacheAge} ago</p>}
                  </div>
                </div>

                <div className="bg-white shadow rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('sku')}>
                            SKU <SortIcon active={sortBy === 'sku'} order={sortOrder} />
                          </th>
                          {inventoryData.locations.map(location => (
                            <th key={location} className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 hover:text-blue-600"
                              onClick={() => setSelectedLocation(location)} title={`Click to view ${location} details`}>
                              {location} →
                            </th>
                          ))}
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('total')}>
                            Total <SortIcon active={sortBy === 'total'} order={sortOrder} />
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredInventory.map((item, index) => (
                          <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap"
                              title={`${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`}>{item.sku}</td>
                            {inventoryData.locations.map(location => {
                              const qty = item.locations?.[location] ?? 0;
                              return (
                                <td key={location} className={`px-3 sm:px-4 py-3 text-sm text-center ${qty <= 0 ? 'text-red-600 font-medium' : qty <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                                  {qty.toLocaleString()}
                                </td>
                              );
                            })}
                            <td className={`px-3 sm:px-4 py-3 text-sm text-center font-medium ${item.totalAvailable <= 0 ? 'text-red-600' : item.totalAvailable <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>
                              {item.totalAvailable.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredInventory.length === 0 && <div className="p-8 text-center text-gray-500">No inventory items match your filters.</div>}
                </div>
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
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {forecastViewMode === 'velocity' ? 'Sales Velocity by SKU' : 'Days of Stock by SKU'}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {forecastViewMode === 'velocity' 
                          ? 'Average daily units sold across different time periods' 
                          : 'Estimated days of stock based on sales velocity'}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap items-center">
                      {/* View Mode Toggle */}
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
                      </div>
                      <input type="text" placeholder="Search by SKU or product..." value={forecastSearchTerm} onChange={(e) => setForecastSearchTerm(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <button onClick={refreshAllData} disabled={isRefreshing}
                        className={`px-3 py-2 text-xs font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                        {isRefreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Showing {filteredForecasting.length} SKUs</p>
                </div>

                <div className="bg-white shadow rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('sku')}>
                            SKU <SortIcon active={forecastSortBy === 'sku'} order={forecastSortOrder} />
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                            Inventory
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('avgDaily7d')}>
                            {forecastViewMode === 'velocity' ? '7 Day' : '7D Days'} <SortIcon active={forecastSortBy === 'avgDaily7d'} order={forecastSortOrder} />
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('avgDaily21d')}>
                            {forecastViewMode === 'velocity' ? '3 Week' : '3W Days'} <SortIcon active={forecastSortBy === 'avgDaily21d'} order={forecastSortOrder} />
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('avgDaily90d')}>
                            {forecastViewMode === 'velocity' ? '3 Month' : '3M Days'} <SortIcon active={forecastSortBy === 'avgDaily90d'} order={forecastSortOrder} />
                          </th>
                          <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleForecastSort('avgDailyLastYear30d')}>
                            {forecastViewMode === 'velocity' ? 'LY 30D' : 'LY Days'} <SortIcon active={forecastSortBy === 'avgDailyLastYear30d'} order={forecastSortOrder} />
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredForecasting.map((item, index) => {
                          const inventory = item.totalInventory || 0;
                          
                          // Calculate days of stock for each period
                          const days7d = calcDaysOfStock(inventory, item.avgDaily7d);
                          const days21d = calcDaysOfStock(inventory, item.avgDaily21d);
                          const days90d = calcDaysOfStock(inventory, item.avgDaily90d);
                          const daysLY30d = calcDaysOfStock(inventory, item.avgDailyLastYear30d);
                          
                          return (
                            <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap" title={item.productName}>{item.sku}</td>
                              <td className={`px-3 sm:px-4 py-3 text-sm text-center ${inventory <= 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>
                                {inventory.toLocaleString()}
                              </td>
                              {forecastViewMode === 'velocity' ? (
                                <>
                                  <td className="px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.avgDaily7d.toFixed(1)}</td>
                                  <td className="px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.avgDaily21d.toFixed(1)}</td>
                                  <td className="px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.avgDaily90d.toFixed(1)}</td>
                                  <td className="px-3 sm:px-4 py-3 text-sm text-center text-gray-500">{item.avgDailyLastYear30d.toFixed(1)}</td>
                                </>
                              ) : (
                                <>
                                  <td className={`px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(days7d)}`}>{formatDaysOfStock(days7d)}</td>
                                  <td className={`px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(days21d)}`}>{formatDaysOfStock(days21d)}</td>
                                  <td className={`px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(days90d)}`}>{formatDaysOfStock(days90d)}</td>
                                  <td className={`px-3 sm:px-4 py-3 text-sm text-center ${getDaysColor(daysLY30d)}`}>{formatDaysOfStock(daysLY30d)}</td>
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
