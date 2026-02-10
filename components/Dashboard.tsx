'use client';

/**
 * Inventory Dashboard Component
 * Displays inventory levels and forecasting data
 */

import { useState, useEffect, useRef, Fragment, startTransition } from 'react';
import { signOut } from 'next-auth/react';
import { PRODUCT_CATEGORIES, findProductCategory } from '@/lib/constants';

// Discontinued SKUs - grayed out in Overview, Planning, and Forecast tabs
const DISCONTINUED_SKUS = [
  'MBT24-DG',
  'MBT24RH-DG',
  'MBT25P-DG',
  'MBT25PRH-DG',
  'MBTCT-DG',
  'MBTCTRH-DG',
  'MBTMX-DG',
  'MBTMXRH-DG',
  'ADT24-R',
  'ADTCT-R',
  'ADTMX-L',
  'ADTMX-R',
  'ADTMY-L',
  'ADTMY-R',
  'ADTMY16-L',
  'ADTMY16-R',
];

// Types
interface InventoryByLocation {
  sku: string;
  productTitle: string;
  variantTitle: string;
  locations: Record<string, number>;
  totalAvailable: number;
}

interface TransferDetail {
  id: string;
  name: string;
  quantity: number;
  tags: string[];
  note: string | null;
  createdAt: string;
  expectedArrivalAt: string | null;
}

interface LocationDetail {
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
  airTransfers?: TransferDetail[];
  seaTransfers?: TransferDetail[];
  // For SKUs that map to multiple Shopify variants (e.g., MBT3Y-DG)
  variantInventoryItems?: Array<{ inventoryItemId: string; variantTitle: string; onHand: number }>;
}

interface InventorySummary {
  totalSKUs: number;
  totalUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  locations: string[];
  locationIds: Record<string, string>;
  inventory: InventoryByLocation[];
  locationDetails: Record<string, LocationDetail[]>;
  lastUpdated: string;
  refreshedBy?: string;
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
      role?: 'write' | 'readonly';
    };
  };
}

interface ProductionOrderItem {
  sku: string;
  quantity: number;
  receivedQuantity: number;
  masterCartons?: number;
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
  poNumber?: string;
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

// Transfer types
interface TransferItem {
  sku: string;
  quantity: number;
  receivedQuantity?: number;
  pallet?: string; // For sea shipments: Pallet 1, Pallet 2, etc.
  masterCartons?: number;
}

type TransferStatus = 'draft' | 'in_transit' | 'partial' | 'delivered' | 'cancelled';
type CarrierType = 'FedEx' | 'DHL' | 'UPS' | '';
type TransferType = 'Air Express' | 'Air Slow' | 'Sea' | 'Immediate';

interface Transfer {
  id: string;
  origin: string;
  destination: string;
  transferType: TransferType;
  items: TransferItem[];
  carrier?: CarrierType;
  trackingNumber?: string;
  eta?: string;
  notes: string;
  status: TransferStatus;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  cancelledAt?: string;
  activityLog?: ActivityLogEntry[];
}

type TabType = 'inventory' | 'forecasting' | 'planning' | 'production' | 'warehouse';
type ProductionViewType = 'orders' | 'transfers';

export default function Dashboard({ session }: DashboardProps) {
  // Check if user has read-only access
  const isReadOnly = session.user?.role === 'readonly';
  
  // Tab state - persist to localStorage
  const [activeTab, setActiveTab] = useState<TabType>('inventory');
  const [isTabInitialized, setIsTabInitialized] = useState(false);
  
  // Load saved tab from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('activeTab');
    if (saved && ['inventory', 'forecasting', 'planning', 'production', 'warehouse'].includes(saved)) {
      setActiveTab(saved as TabType);
    }
    setIsTabInitialized(true);
  }, []);
  
  // Save active tab to localStorage when it changes (only after initialization)
  useEffect(() => {
    if (isTabInitialized) {
      localStorage.setItem('activeTab', activeTab);
    }
  }, [activeTab, isTabInitialized]);
  
  // Inventory state
  const [inventoryData, setInventoryData] = useState<InventorySummary | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  
  // Incoming inventory cache (from app transfers, not Shopify)
  // Structure: { [destination]: { [sku]: { inboundAir, inboundSea, airTransfers, seaTransfers } } }
  const [incomingInventoryCache, setIncomingInventoryCache] = useState<Record<string, Record<string, {
    inboundAir: number;
    inboundSea: number;
    airTransfers: Array<{ transferId: string; quantity: number; note: string | null; createdAt: string; expectedArrivalAt: string | null }>;
    seaTransfers: Array<{ transferId: string; quantity: number; note: string | null; createdAt: string; expectedArrivalAt: string | null }>;
  }>>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const [searchSuggestionIndex, setSearchSuggestionIndex] = useState<number>(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const [sortBy, setSortBy] = useState<string>('sku');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [filterOutOfStock, setFilterOutOfStock] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [inventoryFilterProducts, setInventoryFilterProducts] = useState<string[]>([]);
  const [showInventoryProductDropdown, setShowInventoryProductDropdown] = useState(false);
  const inventoryProductDropdownRef = useRef<HTMLDivElement>(null);
  const [inventoryViewMode, setInventoryViewMode] = useState<'list' | 'grouped'>('grouped');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [inventoryLocationFilters, setInventoryLocationFilters] = useState<string[]>([]);
  const [locationSearchTerm, setLocationSearchTerm] = useState('');
  const [showLocationSearchSuggestions, setShowLocationSearchSuggestions] = useState(false);
  const [locationSearchSuggestionIndex, setLocationSearchSuggestionIndex] = useState<number>(-1);
  const locationSearchRef = useRef<HTMLDivElement>(null);
  const [locationSortBy, setLocationSortBy] = useState<'sku' | 'onHand' | 'available' | 'committed' | 'inboundAir' | 'inboundSea'>('sku');
  const [locationSortOrder, setLocationSortOrder] = useState<'asc' | 'desc'>('asc');
  const [locationViewMode, setLocationViewMode] = useState<'list' | 'grouped'>('grouped');

  // Forecasting state
  const [forecastingData, setForecastingData] = useState<ForecastingData | null>(null);
  const [forecastingLoading, setForecastingLoading] = useState(false);
  const [forecastingError, setForecastingError] = useState<string | null>(null);
  const [forecastSearchTerm, setForecastSearchTerm] = useState('');
  const [showForecastSearchSuggestions, setShowForecastSearchSuggestions] = useState(false);
  const [forecastSearchSuggestionIndex, setForecastSearchSuggestionIndex] = useState<number>(-1);
  const forecastSearchRef = useRef<HTMLDivElement>(null);
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
  const [showPlanningSearchSuggestions, setShowPlanningSearchSuggestions] = useState(false);
  const [planningSearchSuggestionIndex, setPlanningSearchSuggestionIndex] = useState<number>(-1);
  const planningSearchRef = useRef<HTMLDivElement>(null);
  const [planningBurnPeriod, setPlanningBurnPeriod] = useState<'7d' | '21d' | '90d'>('21d');
  const [planningFilterShipTypes, setPlanningFilterShipTypes] = useState<string[]>([]);
  const [showColumnDefinitions, setShowColumnDefinitions] = useState(false);
  const [showOverviewColumnDefinitions, setShowOverviewColumnDefinitions] = useState(false);
  const [planningFilterProdStatus, setPlanningFilterProdStatus] = useState<string>('all');
  const [planningFilterProducts, setPlanningFilterProducts] = useState<string[]>([]);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const productDropdownRef = useRef<HTMLDivElement>(null);
  const [planningListMode, setPlanningListMode] = useState<'list' | 'grouped'>('grouped');
  const [planningRunwayDisplay, setPlanningRunwayDisplay] = useState<'days' | 'dates'>('days');
  const [planningSortBy, setPlanningSortBy] = useState<'sku' | 'la' | 'inboundAir' | 'inboundSea' | 'china' | 'poQty' | 'unitsPerDay' | 'laNeed' | 'shipType' | 'runwayAir' | 'prodStatus' | 'laRunway' | 'cnRunway'>('shipType');
  const [planningSortOrder, setPlanningSortOrder] = useState<'asc' | 'desc'>('asc');
  const [planningLaTargetDays, setPlanningLaTargetDays] = useState<number>(30);

  // Purchase Order state (from manual production orders)
  const [purchaseOrderData, setPurchaseOrderData] = useState<PurchaseOrderData | null>(null);

  // Production Orders state
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);
  const [productionOrdersLoading, setProductionOrdersLoading] = useState(false);
  const [showNewOrderForm, setShowNewOrderForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ProductionOrder | null>(null);
  const [newOrderItems, setNewOrderItems] = useState<{ sku: string; quantity: string; masterCartons: string }[]>([{ sku: '', quantity: '', masterCartons: '' }]);
  const [newOrderNotes, setNewOrderNotes] = useState('');
  const [newOrderVendor, setNewOrderVendor] = useState('');
  const [newOrderEta, setNewOrderEta] = useState('');
  const [productionFilterStatus, setProductionFilterStatus] = useState<'all' | 'open' | 'completed'>('open');
  const [skuSearchQuery, setSkuSearchQuery] = useState('');
  const [skuSearchSelected, setSkuSearchSelected] = useState(''); // The selected SKU for filtering
  const [showSkuSearchSuggestions, setShowSkuSearchSuggestions] = useState(false);
  const [skuSearchSuggestionIndex, setSkuSearchSuggestionIndex] = useState<number>(-1);
  const [poDateFilter, setPoDateFilter] = useState<string>('all'); // 'all' | '1m' | '3m' | '6m' | '1y' | '2y'
  const [skuSuggestionIndex, setSkuSuggestionIndex] = useState<number | null>(null);
  const skuSearchRef = useRef<HTMLDivElement>(null);
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [deliveryItems, setDeliveryItems] = useState<{ sku: string; quantity: string }[]>([]);
  const [deliveryLocation, setDeliveryLocation] = useState<'LA Office' | 'DTLA WH' | 'ShipBob' | 'China WH'>('China WH');
  const [showDeliveryConfirm, setShowDeliveryConfirm] = useState(false);
  const [isUpdatingShopify, setIsUpdatingShopify] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editOrderItems, setEditOrderItems] = useState<{ sku: string; quantity: string; masterCartons: string }[]>([]);
  const [editOrderVendor, setEditOrderVendor] = useState('');
  const [editOrderEta, setEditOrderEta] = useState('');
  const [editOrderNotes, setEditOrderNotes] = useState('');
  const [editOrderSkuSuggestionIndex, setEditOrderSkuSuggestionIndex] = useState<number | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isLoggingDelivery, setIsLoggingDelivery] = useState(false);
  
  // Toast notification state for Production/Transfers
  const [prodNotification, setProdNotification] = useState<{
    type: 'success' | 'error' | 'warning';
    title: string;
    message: string;
  } | null>(null);

  // Production tab view toggle (Production Orders vs Transfers)
  const [productionViewType, setProductionViewType] = useState<ProductionViewType>('transfers');

  // Transfers state
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [showNewTransferForm, setShowNewTransferForm] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [newTransferOrigin, setNewTransferOrigin] = useState<string>('');
  const [newTransferDestination, setNewTransferDestination] = useState<string>('');
  const [newTransferItems, setNewTransferItems] = useState<{ sku: string; quantity: string; pallet?: string; masterCartons: string }[]>([{ sku: '', quantity: '', pallet: 'Pallet 1', masterCartons: '' }]);
  const [newTransferType, setNewTransferType] = useState<TransferType | ''>('');
  const [newTransferCarrier, setNewTransferCarrier] = useState<CarrierType>('');
  const [newTransferTracking, setNewTransferTracking] = useState('');
  const [newTransferNotes, setNewTransferNotes] = useState('');
  const [newTransferEta, setNewTransferEta] = useState('');
  const [transferFilterStatus, setTransferFilterStatus] = useState<'all' | 'active' | 'completed'>('all');
  const [transferDateFilter, setTransferDateFilter] = useState('all');
  const [transferSkuSearchQuery, setTransferSkuSearchQuery] = useState('');
  const [transferSkuSearchSelected, setTransferSkuSearchSelected] = useState('');
  const [showTransferSkuSearchSuggestions, setShowTransferSkuSearchSuggestions] = useState(false);
  const [transferSkuSearchSuggestionIndex, setTransferSkuSearchSuggestionIndex] = useState<number>(-1);
  const transferSkuSearchRef = useRef<HTMLDivElement>(null);
  const [transferSkuSuggestionIndex, setTransferSkuSuggestionIndex] = useState<number | null>(null);
  const [isCreatingTransfer, setIsCreatingTransfer] = useState(false);
  const [showEditTransferForm, setShowEditTransferForm] = useState(false);
  const [editTransferOrigin, setEditTransferOrigin] = useState('');
  const [editTransferDestination, setEditTransferDestination] = useState('');
  const [editTransferType, setEditTransferType] = useState<TransferType | ''>('');
  const [editTransferItems, setEditTransferItems] = useState<{ sku: string; quantity: string; pallet?: string; masterCartons: string }[]>([]);
  const [editTransferCarrier, setEditTransferCarrier] = useState<CarrierType>('');
  const [editTransferTracking, setEditTransferTracking] = useState('');
  const [editTransferEta, setEditTransferEta] = useState('');
  const [editTransferNotes, setEditTransferNotes] = useState('');
  const [editTransferSkuSuggestionIndex, setEditTransferSkuSuggestionIndex] = useState<number | null>(null);
  const [isSavingTransfer, setIsSavingTransfer] = useState(false);
  const [showCancelTransferConfirm, setShowCancelTransferConfirm] = useState(false);
  const [isCancellingTransfer, setIsCancellingTransfer] = useState(false);
  const [isUpdatingTransferStatus, setIsUpdatingTransferStatus] = useState(false);
  const [showTransferDeliveryForm, setShowTransferDeliveryForm] = useState(false);
  const [transferDeliveryItems, setTransferDeliveryItems] = useState<{ sku: string; quantity: string }[]>([]);
  const [showMarkInTransitConfirm, setShowMarkInTransitConfirm] = useState(false);
  const [transferToMarkInTransit, setTransferToMarkInTransit] = useState<Transfer | null>(null);
  const [isMarkingInTransit, setIsMarkingInTransit] = useState(false);
  const [showLogDeliveryConfirm, setShowLogDeliveryConfirm] = useState(false);
  const [showImmediateTransferConfirm, setShowImmediateTransferConfirm] = useState(false);
  const [pendingImmediateTransfer, setPendingImmediateTransfer] = useState<{
    origin: string;
    destination: string;
    items: { sku: string; quantity: number }[];
    carrier?: string;
    trackingNumber?: string;
    eta?: string;
    notes?: string;
  } | null>(null);
  const [isExecutingImmediateTransfer, setIsExecutingImmediateTransfer] = useState(false);

  // Available locations for transfers
  const transferLocations = ['LA Office', 'DTLA WH', 'ShipBob', 'China WH'];

  // Get incoming quantities from cache (tracked from app transfers, not Shopify)
  // Returns a map of destination -> SKU -> { inboundAir, inboundSea, airTransfers, seaTransfers }
  // Cache is updated when transfers are marked in transit or deliveries are logged
  const getIncomingFromTransfers = () => {
    // Transform cache format to match TransferDetail interface
    const result: Record<string, Record<string, {
      inboundAir: number;
      inboundSea: number;
      airTransfers: TransferDetail[];
      seaTransfers: TransferDetail[];
    }>> = {};

    for (const [destination, skuData] of Object.entries(incomingInventoryCache)) {
      result[destination] = {};
      for (const [sku, data] of Object.entries(skuData)) {
        result[destination][sku] = {
          inboundAir: data.inboundAir,
          inboundSea: data.inboundSea,
          airTransfers: data.airTransfers.map(t => ({
            id: t.transferId,
            name: t.transferId,
            quantity: t.quantity,
            tags: ['Air'],
            note: t.note,
            createdAt: t.createdAt,
            expectedArrivalAt: t.expectedArrivalAt || null,
          })),
          seaTransfers: data.seaTransfers.map(t => ({
            id: t.transferId,
            name: t.transferId,
            quantity: t.quantity,
            tags: ['Sea'],
            note: t.note,
            createdAt: t.createdAt,
            expectedArrivalAt: t.expectedArrivalAt || null,
          })),
        };
      }
    }

    return result;
  };

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Global status overlay state
  const [globalStatus, setGlobalStatus] = useState<{ message: string; subMessage?: string } | null>(null);

  // Phase out state
  const [showPhaseOutModal, setShowPhaseOutModal] = useState(false);
  const [phaseOutSkus, setPhaseOutSkus] = useState<string[]>([]);
  const [newPhaseOutSku, setNewPhaseOutSku] = useState('');
  const [isAddingPhaseOut, setIsAddingPhaseOut] = useState(false);
  const [isRemovingPhaseOut, setIsRemovingPhaseOut] = useState<string | null>(null);

  // Hidden SKUs state (for Inventory Counts tab)
  const [showHiddenSkusModal, setShowHiddenSkusModal] = useState(false);
  const [hiddenSkus, setHiddenSkus] = useState<string[]>([]);
  const [newHiddenSku, setNewHiddenSku] = useState('');
  const [isAddingHiddenSku, setIsAddingHiddenSku] = useState(false);
  const [isRemovingHiddenSku, setIsRemovingHiddenSku] = useState<string | null>(null);

  // SKU Comments state
  const [showSkuCommentForm, setShowSkuCommentForm] = useState(false);
  const [skuComments, setSkuComments] = useState<Record<string, { comment: string; updatedAt: string; updatedBy: string }>>({});
  const [commentSkuSearch, setCommentSkuSearch] = useState('');
  const [commentSkuSelected, setCommentSkuSelected] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [showCommentSkuSuggestions, setShowCommentSkuSuggestions] = useState(false);
  const commentSkuSearchRef = useRef<HTMLDivElement>(null);

  // Master Cartons (MC) data state
  const [mcData, setMcData] = useState<Record<string, number>>({});
  const [showMcEditForm, setShowMcEditForm] = useState(false);
  const [isSavingMcData, setIsSavingMcData] = useState(false);
  const [mcSearchTerm, setMcSearchTerm] = useState('');

  // Inventory Tracker state
  type TrackerLocation = 'LA Office' | 'DTLA WH' | 'China WH';
  const [trackerLocation, setTrackerLocation] = useState<TrackerLocation>('LA Office');
  const [trackerCounts, setTrackerCounts] = useState<Record<TrackerLocation, Record<string, number | null>>>({
    'LA Office': {},
    'DTLA WH': {},
    'China WH': {},
  });
  const [trackerSearchTerm, setTrackerSearchTerm] = useState('');
  const [showTrackerSearchSuggestions, setShowTrackerSearchSuggestions] = useState(false);
  const [trackerSearchSuggestionIndex, setTrackerSearchSuggestionIndex] = useState<number>(-1);
  const trackerSearchRef = useRef<HTMLDivElement>(null);
  const [trackerSortBy, setTrackerSortBy] = useState<'sku' | 'onHand' | 'counted' | 'difference'>('sku');
  const [trackerSortOrder, setTrackerSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showTrackerConfirm, setShowTrackerConfirm] = useState(false);
  const [showTrackerClearConfirm, setShowTrackerClearConfirm] = useState(false);
  const [isSubmittingTracker, setIsSubmittingTracker] = useState(false);
  const [trackerFilterProducts, setTrackerFilterProducts] = useState<string[]>([]);
  const [showTrackerProductDropdown, setShowTrackerProductDropdown] = useState(false);
  const trackerProductDropdownRef = useRef<HTMLDivElement>(null);
  const [trackerViewMode, setTrackerViewMode] = useState<'list' | 'grouped'>('grouped');
  const [showTrackerLogs, setShowTrackerLogs] = useState(false);
  const [trackerLogs, setTrackerLogs] = useState<Array<{
    timestamp: string;
    submittedBy: string;
    location: string;
    summary: { totalSKUs: number; discrepancies: number; totalDifference: number };
    updates: Array<{ sku: string; previousOnHand: number; newQuantity: number }>;
    result: { total: number; success: number; failed: number };
  }>>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [trackerDraftInfo, setTrackerDraftInfo] = useState<Record<TrackerLocation, { savedAt: string; savedBy: string } | null>>({
    'LA Office': null,
    'DTLA WH': null,
    'China WH': null,
  });
  const [trackerLastSubmission, setTrackerLastSubmission] = useState<Record<TrackerLocation, { submittedAt: string; submittedBy: string; skuCount: number; isTest?: boolean } | null>>({
    'LA Office': null,
    'DTLA WH': null,
    'China WH': null,
  });
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [trackerNotification, setTrackerNotification] = useState<{
    type: 'success' | 'error' | 'warning';
    title: string;
    message: string;
  } | null>(null);
  const [trackerTestMode, setTrackerTestMode] = useState(false);
  
  // Shared draft state (auto-merged from all contributors)
  const [draftContributors, setDraftContributors] = useState<string[]>([]);
  const [countDetails, setCountDetails] = useState<Record<string, { countedBy: string; countedAt: string }>>({});
  const [currentUserName, setCurrentUserName] = useState<string>('');

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

  // Load hidden SKUs for Inventory Counts tab
  const loadHiddenSkus = async () => {
    try {
      const response = await fetch('/api/hidden-skus');
      if (response.ok) {
        const data = await response.json();
        setHiddenSkus(data.skus?.map((s: { sku: string }) => s.sku) || []);
      }
    } catch (error) {
      console.error('Error loading hidden SKUs:', error);
    }
  };

  // Add SKU to hidden list
  const addHiddenSku = async () => {
    if (!newHiddenSku.trim() || isAddingHiddenSku) return;
    setIsAddingHiddenSku(true);
    try {
      const response = await fetch('/api/hidden-skus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: newHiddenSku.trim() }),
      });
      if (response.ok) {
        const data = await response.json();
        setHiddenSkus(data.skus?.map((s: { sku: string }) => s.sku) || []);
        setNewHiddenSku('');
      }
    } catch (error) {
      console.error('Error adding hidden SKU:', error);
    } finally {
      setIsAddingHiddenSku(false);
    }
  };

  // Remove SKU from hidden list
  const removeHiddenSku = async (sku: string) => {
    if (isRemovingHiddenSku) return;
    setIsRemovingHiddenSku(sku);
    try {
      const response = await fetch(`/api/hidden-skus?sku=${encodeURIComponent(sku)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        const data = await response.json();
        setHiddenSkus(data.skus?.map((s: { sku: string }) => s.sku) || []);
      }
    } catch (error) {
      console.error('Error removing hidden SKU:', error);
    } finally {
      setIsRemovingHiddenSku(null);
    }
  };

  // Load SKU comments
  const loadSkuComments = async () => {
    try {
      const response = await fetch('/api/sku-comments');
      if (response.ok) {
        const data = await response.json();
        const commentsMap: Record<string, { comment: string; updatedAt: string; updatedBy: string }> = {};
        if (data.comments) {
          for (const [sku, info] of Object.entries(data.comments)) {
            const commentInfo = info as { comment: string; updatedAt: string; updatedBy: string };
            commentsMap[sku] = {
              comment: commentInfo.comment,
              updatedAt: commentInfo.updatedAt,
              updatedBy: commentInfo.updatedBy,
            };
          }
        }
        setSkuComments(commentsMap);
      }
    } catch (error) {
      console.error('Error loading SKU comments:', error);
    }
  };

  // Save SKU comment
  const saveSkuComment = async () => {
    if (!commentSkuSelected || isSavingComment) return;
    setIsSavingComment(true);
    try {
      const response = await fetch('/api/sku-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: commentSkuSelected, comment: commentText }),
      });
      if (response.ok) {
        const data = await response.json();
        const commentsMap: Record<string, { comment: string; updatedAt: string; updatedBy: string }> = {};
        if (data.comments) {
          for (const [sku, info] of Object.entries(data.comments)) {
            const commentInfo = info as { comment: string; updatedAt: string; updatedBy: string };
            commentsMap[sku] = {
              comment: commentInfo.comment,
              updatedAt: commentInfo.updatedAt,
              updatedBy: commentInfo.updatedBy,
            };
          }
        }
        setSkuComments(commentsMap);
        // Reset form
        setCommentSkuSearch('');
        setCommentSkuSelected('');
        setCommentText('');
        setShowSkuCommentForm(false);
      }
    } catch (error) {
      console.error('Error saving SKU comment:', error);
    } finally {
      setIsSavingComment(false);
    }
  };

  // Load MC data
  const loadMcData = async () => {
    try {
      const response = await fetch('/api/mc-data');
      if (response.ok) {
        const data = await response.json();
        setMcData(data || {});
      }
    } catch (error) {
      console.error('Error loading MC data:', error);
    }
  };

  // Save MC data
  const saveMcData = async (updatedMcData: Record<string, number>) => {
    setIsSavingMcData(true);
    try {
      const response = await fetch('/api/mc-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMcData),
      });
      if (response.ok) {
        setMcData(updatedMcData);
        setShowMcEditForm(false);
        setMcSearchTerm('');
        showProdNotification('success', 'Saved', 'MC data saved successfully');
      }
    } catch (error) {
      console.error('Error saving MC data:', error);
      showProdNotification('error', 'Save Failed', 'Failed to save MC data');
    } finally {
      setIsSavingMcData(false);
    }
  };

  // Calculate MC from quantity
  const calculateMC = (sku: string, quantity: number): number | null => {
    const unitsPerMc = mcData[sku.toUpperCase()];
    if (!unitsPerMc) return null;
    return Math.ceil(quantity / unitsPerMc);
  };

  // Load incoming inventory from cache (tracked from app transfers)
  const loadIncomingFromCache = async () => {
    try {
      const response = await fetch('/api/incoming');
      if (response.ok) {
        const data = await response.json();
        setIncomingInventoryCache(data.incomingInventory || {});
      }
    } catch (err) {
      console.error('Error loading incoming inventory cache:', err);
    }
  };

  // Load cached inventory data
  const loadInventoryFromCache = async () => {
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      // Load both inventory and incoming data in parallel
      const [inventoryResponse] = await Promise.all([
        fetch('/api/inventory'),
        loadIncomingFromCache(),
      ]);
      
      const data = await inventoryResponse.json();
      if (!inventoryResponse.ok) {
        // No cache available - this is expected on first load
        if (inventoryResponse.status === 503) {
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

  // Load transfers
  const loadTransfers = async () => {
    setTransfersLoading(true);
    try {
      const response = await fetch('/api/transfers');
      const data = await response.json();
      if (response.ok) {
        setTransfers(data.transfers || []);
      }
    } catch (err) {
      console.error('Failed to load transfers:', err);
    } finally {
      setTransfersLoading(false);
    }
  };

  // Create new transfer
  const createTransfer = async () => {
    if (isCreatingTransfer) return; // Prevent double-clicks
    
    if (!newTransferOrigin) {
      showProdNotification('error', 'Missing Origin', 'Please select an origin location');
      return;
    }
    
    if (!newTransferDestination) {
      showProdNotification('error', 'Missing Destination', 'Please select a destination location');
      return;
    }
    
    if (!newTransferType) {
      showProdNotification('error', 'Missing Shipment Type', 'Please select a shipment type');
      return;
    }
    
    if (newTransferOrigin === newTransferDestination) {
      showProdNotification('error', 'Invalid Locations', 'Origin and destination cannot be the same');
      return;
    }
    
    const validItems = newTransferItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ 
        sku: item.sku.trim().toUpperCase(), 
        quantity: parseInt(item.quantity),
        ...(newTransferType === 'Sea' && item.pallet ? { pallet: item.pallet } : {}),
        ...(item.masterCartons && parseInt(item.masterCartons) > 0 ? { masterCartons: parseInt(item.masterCartons) } : {}),
      }));

    if (validItems.length === 0) {
      showProdNotification('error', 'Missing Items', 'Please add at least one SKU with quantity');
      return;
    }

    // Validate all SKUs exist in inventory
    const invalidSkus = validItems.filter(item => 
      !inventoryData?.inventory.some(inv => inv.sku.toUpperCase() === item.sku.toUpperCase())
    );
    if (invalidSkus.length > 0) {
      showProdNotification('error', 'Invalid SKU', `SKU${invalidSkus.length > 1 ? 's' : ''} not found: ${invalidSkus.map(i => i.sku).join(', ')}`);
      return;
    }

    // For Immediate transfers, show confirmation modal
    if (newTransferType === 'Immediate') {
      setPendingImmediateTransfer({
        origin: newTransferOrigin,
        destination: newTransferDestination,
        items: validItems,
        carrier: newTransferCarrier || undefined,
        trackingNumber: newTransferTracking.trim() || undefined,
        eta: newTransferEta || undefined,
        notes: newTransferNotes.trim() || undefined,
      });
      setShowImmediateTransferConfirm(true);
      return;
    }

    // For Air/Sea transfers, create as draft
    await executeCreateTransfer(validItems);
  };

  // Execute the actual transfer creation (for non-immediate or after confirmation)
  const executeCreateTransfer = async (validItems: { sku: string; quantity: number; pallet?: string; masterCartons?: number }[]) => {
    setIsCreatingTransfer(true);

    try {
      const response = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: newTransferOrigin,
          destination: newTransferDestination,
          transferType: newTransferType,
          items: validItems,
          carrier: newTransferCarrier || undefined,
          trackingNumber: newTransferTracking.trim() || undefined,
          eta: newTransferEta || undefined,
          notes: newTransferNotes.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setTransfers(prev => [data.transfer, ...prev]);
        setShowNewTransferForm(false);
        setNewTransferOrigin('');
        setNewTransferDestination('');
        setNewTransferType('');
        setNewTransferItems([{ sku: '', quantity: '', pallet: 'Pallet 1', masterCartons: '' }]);
        setNewTransferCarrier('');
        setNewTransferTracking('');
        setNewTransferEta('');
        setNewTransferNotes('');
        showProdNotification('success', 'Transfer Created', `Transfer ${data.transfer.id} created successfully`);
      } else {
        showProdNotification('error', 'Create Failed', data.error || 'Failed to create transfer');
      }
    } catch (err) {
      console.error('Failed to create transfer:', err);
      showProdNotification('error', 'Create Failed', 'Failed to create transfer');
    } finally {
      setIsCreatingTransfer(false);
    }
  };

  // Confirm and execute immediate transfer (creates + executes in one step)
  const confirmImmediateTransfer = async () => {
    if (!pendingImmediateTransfer || isExecutingImmediateTransfer) return;
    
    // Check stock availability at origin before proceeding
    const originDetails = inventoryData?.locationDetails?.[pendingImmediateTransfer.origin];
    if (originDetails) {
      const insufficientStock: { sku: string; requested: number; available: number }[] = [];
      
      for (const item of pendingImmediateTransfer.items) {
        const detail = originDetails.find((d: { sku: string; onHand: number }) => d.sku.toUpperCase() === item.sku.toUpperCase());
        const availableAtOrigin = detail?.onHand || 0;
        
        if (availableAtOrigin < item.quantity) {
          insufficientStock.push({
            sku: item.sku,
            requested: item.quantity,
            available: availableAtOrigin,
          });
        }
      }
      
      if (insufficientStock.length > 0) {
        const stockDetails = insufficientStock
          .map(s => `${s.sku}: need ${s.requested.toLocaleString()}, only ${s.available.toLocaleString()} at ${pendingImmediateTransfer.origin}`)
          .join('\n');
        showProdNotification('error', 'Insufficient Stock', stockDetails);
        return;
      }
    }
    
    setIsExecutingImmediateTransfer(true);

    try {
      // Step 1: Create the transfer
      const createResponse = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: pendingImmediateTransfer.origin,
          destination: pendingImmediateTransfer.destination,
          transferType: 'Immediate',
          items: pendingImmediateTransfer.items,
          carrier: pendingImmediateTransfer.carrier,
          trackingNumber: pendingImmediateTransfer.trackingNumber,
          eta: pendingImmediateTransfer.eta,
          notes: pendingImmediateTransfer.notes,
        }),
      });

      const createData = await createResponse.json();

      if (!createResponse.ok) {
        showProdNotification('error', 'Create Failed', createData.error || 'Failed to create transfer');
        return;
      }

      const newTransfer = createData.transfer;

      // Step 2: Update Shopify inventory (subtract from origin, add to destination)
      const inventoryResponse = await fetch('/api/transfers/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_in_transit',
          transferId: newTransfer.id,
          origin: pendingImmediateTransfer.origin,
          destination: pendingImmediateTransfer.destination,
          shipmentType: 'Immediate',
          items: pendingImmediateTransfer.items,
        }),
      });

      const inventoryResult = await inventoryResponse.json();

      if (!inventoryResponse.ok) {
        showProdNotification('error', 'Shopify Update Failed', inventoryResult.error || 'Failed to update Shopify inventory');
        // Still update UI with the created transfer
        setTransfers(prev => [newTransfer, ...prev]);
        return;
      }

      // Step 3: Update transfer status to 'delivered'
      const statusResponse = await fetch('/api/transfers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferId: newTransfer.id,
          status: 'delivered',
          receivedItems: pendingImmediateTransfer.items.map(i => ({ sku: i.sku, quantity: i.quantity })),
        }),
      });

      const statusData = await statusResponse.json();

      if (statusResponse.ok) {
        setTransfers(prev => [statusData.transfer, ...prev]);
        showProdNotification('success', 'Transfer Complete', `Stock moved from ${pendingImmediateTransfer.origin} to ${pendingImmediateTransfer.destination}`);
      } else {
        setTransfers(prev => [newTransfer, ...prev]);
        showProdNotification('error', 'Status Update Failed', statusData.error || 'Transfer created but status update failed');
      }

      // Reset form
      setShowNewTransferForm(false);
      setNewTransferOrigin('');
      setNewTransferDestination('');
      setNewTransferType('');
      setNewTransferItems([{ sku: '', quantity: '', pallet: 'Pallet 1', masterCartons: '' }]);
      setNewTransferCarrier('');
      setNewTransferTracking('');
      setNewTransferEta('');
      setNewTransferNotes('');
      setShowImmediateTransferConfirm(false);
      setPendingImmediateTransfer(null);

    } catch (err) {
      console.error('Failed to execute immediate transfer:', err);
      showProdNotification('error', 'Transfer Failed', 'Failed to complete immediate transfer');
    } finally {
      setIsExecutingImmediateTransfer(false);
    }
  };

  // Update transfer status (for non-Shopify status changes like cancel)
  const updateTransferStatus = async (transferId: string, newStatus: TransferStatus) => {
    if (isUpdatingTransferStatus) return;
    setIsUpdatingTransferStatus(true);
    try {
      const response = await fetch('/api/transfers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferId,
          status: newStatus,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setTransfers(prev => prev.map(t => t.id === transferId ? data.transfer : t));
        const statusLabel = newStatus === 'in_transit' ? 'In Transit' : newStatus === 'delivered' ? 'Delivered' : newStatus === 'partial' ? 'Partial' : newStatus;
        showProdNotification('success', 'Status Updated', `Transfer ${transferId} marked as ${statusLabel}`);
      } else {
        showProdNotification('error', 'Update Failed', data.error || 'Failed to update transfer');
      }
    } catch (err) {
      console.error('Failed to update transfer:', err);
      showProdNotification('error', 'Update Failed', 'Failed to update transfer status');
    } finally {
      setIsUpdatingTransferStatus(false);
    }
  };

  // Show Mark In Transit confirmation modal
  const showMarkInTransitConfirmation = (transfer: Transfer) => {
    setTransferToMarkInTransit(transfer);
    setShowMarkInTransitConfirm(true);
  };

  // Confirm Mark In Transit - updates Shopify inventory then transfer status
  // For Immediate shipments: transfers stock directly (origin -> destination On Hand)
  // For Air/Sea shipments: subtracts from origin only (incoming tracked in app)
  const confirmMarkInTransit = async () => {
    if (!transferToMarkInTransit || isMarkingInTransit) return;
    
    const isImmediate = transferToMarkInTransit.transferType === 'Immediate';
    
    // Check stock availability at origin before proceeding
    const originDetails = inventoryData?.locationDetails?.[transferToMarkInTransit.origin];
    if (originDetails) {
      const insufficientStock: { sku: string; requested: number; available: number }[] = [];
      
      for (const item of transferToMarkInTransit.items) {
        const detail = originDetails.find((d: { sku: string; onHand: number }) => d.sku.toUpperCase() === item.sku.toUpperCase());
        const availableAtOrigin = detail?.onHand || 0;
        
        if (availableAtOrigin < item.quantity) {
          insufficientStock.push({
            sku: item.sku,
            requested: item.quantity,
            available: availableAtOrigin,
          });
        }
      }
      
      if (insufficientStock.length > 0) {
        const stockDetails = insufficientStock
          .map(s => `${s.sku}: need ${s.requested.toLocaleString()}, only ${s.available.toLocaleString()} at ${transferToMarkInTransit.origin}`)
          .join('\n');
        showProdNotification('error', 'Insufficient Stock', stockDetails);
        return;
      }
    }
    
    setIsMarkingInTransit(true);
    setGlobalStatus({ 
      message: isImmediate ? 'Processing Immediate Transfer...' : 'Marking Transfer In Transit...', 
      subMessage: 'Updating Shopify inventory' 
    });
    try {
      // Step 1: Update Shopify inventory
      const inventoryResponse = await fetch('/api/transfers/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_in_transit',
          transferId: transferToMarkInTransit.id,
          origin: transferToMarkInTransit.origin,
          destination: transferToMarkInTransit.destination,
          shipmentType: transferToMarkInTransit.transferType,
          items: transferToMarkInTransit.items.map(i => ({ sku: i.sku, quantity: i.quantity })),
          note: transferToMarkInTransit.notes || null,
          expectedArrivalAt: transferToMarkInTransit.eta || null,
        }),
      });

      const inventoryResult = await inventoryResponse.json();

      if (!inventoryResponse.ok) {
        showProdNotification('error', 'Shopify Update Failed', inventoryResult.details || inventoryResult.error || 'Failed to update Shopify inventory');
        return;
      }

      // Step 2: Update transfer status
      // Immediate transfers are marked as 'delivered' since the stock transfer is instant
      // Air/Sea transfers are marked as 'in_transit' since stock is incoming
      const newStatus = isImmediate ? 'delivered' : 'in_transit';
      
      const statusResponse = await fetch('/api/transfers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferId: transferToMarkInTransit.id,
          status: newStatus,
          // For immediate transfers, also set received items = sent items
          ...(isImmediate && {
            receivedItems: transferToMarkInTransit.items.map(i => ({ sku: i.sku, quantity: i.quantity })),
          }),
        }),
      });

      const statusData = await statusResponse.json();

      if (statusResponse.ok) {
        setTransfers(prev => prev.map(t => t.id === transferToMarkInTransit.id ? statusData.transfer : t));
        setShowMarkInTransitConfirm(false);
        setTransferToMarkInTransit(null);
        
        if (isImmediate) {
          showProdNotification('success', 'Transfer Complete', `Transfer ${transferToMarkInTransit.id} completed. Stock moved from ${transferToMarkInTransit.origin} to ${transferToMarkInTransit.destination}.`);
        } else {
          // Reload incoming cache since we added new incoming items
          await loadIncomingFromCache();
          showProdNotification('success', 'In Transit', `Transfer ${transferToMarkInTransit.id} marked in transit. Shopify inventory updated.`);
        }
      } else {
        showProdNotification('error', 'Status Update Failed', statusData.error || 'Shopify updated but failed to update transfer status');
      }
    } catch (err) {
      console.error('Failed to mark in transit:', err);
      showProdNotification('error', 'Update Failed', 'Failed to process transfer');
    } finally {
      setGlobalStatus(null);
      setIsMarkingInTransit(false);
    }
  };

  // Show delivery confirmation modal (validates first)
  const showDeliveryConfirmation = () => {
    if (!selectedTransfer) return;
    
    const validDeliveries = transferDeliveryItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ sku: item.sku.trim().toUpperCase(), quantity: parseInt(item.quantity) }));

    if (validDeliveries.length === 0) {
      showProdNotification('error', 'Missing Deliveries', 'Please enter at least one delivery quantity');
      return;
    }

    // Validate all SKUs exist in inventory
    const invalidSkus = validDeliveries.filter(item => 
      !inventoryData?.inventory.some(inv => inv.sku.toUpperCase() === item.sku.toUpperCase())
    );
    if (invalidSkus.length > 0) {
      showProdNotification('error', 'Invalid SKU', `SKU${invalidSkus.length > 1 ? 's' : ''} not found: ${invalidSkus.map(i => i.sku).join(', ')}`);
      return;
    }

    // Close delivery form and show confirmation
    setShowTransferDeliveryForm(false);
    setShowLogDeliveryConfirm(true);
  };

  // Confirm Log Delivery - updates Shopify inventory then transfer
  const confirmLogDelivery = async () => {
    if (isLoggingDelivery || !selectedTransfer) return;
    
    const validDeliveries = transferDeliveryItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ sku: item.sku.trim().toUpperCase(), quantity: parseInt(item.quantity) }));

    if (validDeliveries.length === 0) {
      showProdNotification('error', 'Missing Deliveries', 'Please enter at least one delivery quantity');
      return;
    }

    setIsLoggingDelivery(true);
    setGlobalStatus({ message: 'Logging Transfer Delivery...', subMessage: 'Updating Shopify inventory' });
    try {
      // Step 1: Update Shopify inventory (add to destination on_hand) and update incoming cache
      const inventoryResponse = await fetch('/api/transfers/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'log_delivery',
          transferId: selectedTransfer.id,
          destination: selectedTransfer.destination,
          shipmentType: selectedTransfer.transferType,
          items: validDeliveries,
        }),
      });

      const inventoryData = await inventoryResponse.json();

      if (!inventoryResponse.ok) {
        showProdNotification('error', 'Shopify Update Failed', inventoryData.details || inventoryData.error || 'Failed to update Shopify inventory');
        return;
      }

      // Step 2: Update transfer items with received quantities
      const updatedItems = selectedTransfer.items.map(item => {
        const delivery = validDeliveries.find(d => d.sku === item.sku);
        const currentReceived = item.receivedQuantity || 0;
        const newReceived = delivery ? currentReceived + delivery.quantity : currentReceived;
        return {
          ...item,
          receivedQuantity: newReceived,
        };
      });

      // Determine if fully delivered or partial
      const allDelivered = updatedItems.every(item => (item.receivedQuantity || 0) >= item.quantity);
      const newStatus: TransferStatus = allDelivered ? 'delivered' : 'partial';

      const response = await fetch('/api/transfers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferId: selectedTransfer.id,
          items: updatedItems,
          status: newStatus,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setTransfers(prev => prev.map(t => t.id === selectedTransfer.id ? data.transfer : t));
        setShowTransferDeliveryForm(false);
        setShowLogDeliveryConfirm(false);
        setTransferDeliveryItems([]);
        setSelectedTransfer(data.transfer);
        // Reload incoming cache since we subtracted delivered items
        await loadIncomingFromCache();
        const statusLabel = allDelivered ? 'Delivered' : 'Partial Delivery';
        showProdNotification('success', statusLabel, `Transfer ${selectedTransfer.id} delivery logged. Refreshing data...`);
        
        // Refresh all data from Shopify to ensure accurate dashboard
        try {
          await fetch('/api/refresh');
          await Promise.all([loadInventoryFromCache(), loadForecastingFromCache()]);
          showProdNotification('success', 'Data Refreshed', 'Dashboard updated with latest Shopify data');
        } catch (refreshErr) {
          console.error('Failed to refresh after delivery:', refreshErr);
          // Don't show error - delivery was successful, refresh is just a bonus
        }
      } else {
        showProdNotification('error', 'Log Failed', data.error || 'Shopify updated but failed to update transfer');
      }
    } catch (err) {
      console.error('Failed to log transfer delivery:', err);
      showProdNotification('error', 'Log Failed', 'Failed to log delivery');
    } finally {
      setGlobalStatus(null);
      setIsLoggingDelivery(false);
    }
  };

  // Save transfer edits
  const saveTransferEdits = async () => {
    if (!selectedTransfer || isSavingTransfer) return;
    
    const validItems = editTransferItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ 
        sku: item.sku.trim().toUpperCase(), 
        quantity: parseInt(item.quantity),
        ...(editTransferType === 'Sea' && item.pallet ? { pallet: item.pallet } : {}),
        ...(item.masterCartons && parseInt(item.masterCartons) > 0 ? { masterCartons: parseInt(item.masterCartons) } : {}),
      }));

    if (validItems.length === 0) {
      showProdNotification('error', 'Missing Items', 'Please add at least one SKU with quantity');
      return;
    }

    // Validate all SKUs exist in inventory
    const invalidSkus = validItems.filter(item => 
      !inventoryData?.inventory.some(inv => inv.sku.toUpperCase() === item.sku.toUpperCase())
    );
    if (invalidSkus.length > 0) {
      showProdNotification('error', 'Invalid SKU', `SKU${invalidSkus.length > 1 ? 's' : ''} not found: ${invalidSkus.map(i => i.sku).join(', ')}`);
      return;
    }

    if (!editTransferType) {
      showProdNotification('error', 'Missing Shipment Type', 'Please select a shipment type');
      return;
    }

    if (editTransferOrigin === editTransferDestination) {
      showProdNotification('error', 'Invalid Locations', 'Origin and destination cannot be the same');
      return;
    }

    setIsSavingTransfer(true);

    try {
      const response = await fetch('/api/transfers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferId: selectedTransfer.id,
          origin: editTransferOrigin,
          destination: editTransferDestination,
          transferType: editTransferType,
          items: validItems,
          carrier: editTransferCarrier || undefined,
          trackingNumber: editTransferTracking.trim() || undefined,
          eta: editTransferEta || null, // Use null to allow clearing, undefined would be excluded by JSON.stringify
          notes: editTransferNotes.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setTransfers(prev => prev.map(t => t.id === selectedTransfer.id ? data.transfer : t));
        setShowEditTransferForm(false);
        setSelectedTransfer(data.transfer);
        showProdNotification('success', 'Transfer Updated', 'Transfer updated successfully');
        
        // If transfer is in_transit or partial, rebuild incoming cache so other tabs reflect changes
        // Do this after showing notification to avoid delay
        if (['in_transit', 'partial'].includes(selectedTransfer.status)) {
          try {
            await fetch('/api/transfers/inventory', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'rebuild_incoming' }),
            });
            await loadIncomingFromCache();
          } catch (err) {
            console.warn('Failed to rebuild incoming cache:', err);
          }
        }
      } else {
        showProdNotification('error', 'Update Failed', data.error || 'Failed to update transfer');
      }
    } catch (err) {
      console.error('Failed to update transfer:', err);
      showProdNotification('error', 'Update Failed', 'Failed to update transfer');
    } finally {
      setIsSavingTransfer(false);
    }
  };

  // Cancel transfer
  const cancelTransfer = async () => {
    if (!selectedTransfer || isCancellingTransfer) return;

    setIsCancellingTransfer(true);

    try {
      // Check if this is a partial delivery - need to restock undelivered items
      const isPartialDelivery = selectedTransfer.status === 'partial';
      let restockedItems: Array<{ sku: string; quantity: number }> = [];
      
      if (isPartialDelivery) {
        // Calculate undelivered quantities to restock to origin
        const undeliveredItems = selectedTransfer.items
          .map(item => ({
            sku: item.sku,
            quantity: item.quantity - (item.receivedQuantity || 0),
          }))
          .filter(item => item.quantity > 0);
        
        if (undeliveredItems.length > 0) {
          // Restock undelivered items to origin location in Shopify
          const inventoryResponse = await fetch('/api/transfers/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'restock_cancelled',
              transferId: selectedTransfer.id,
              origin: selectedTransfer.origin,
              items: undeliveredItems,
            }),
          });
          
          if (!inventoryResponse.ok) {
            const inventoryData = await inventoryResponse.json();
            showProdNotification('error', 'Restock Failed', inventoryData.error || 'Failed to restock items to origin');
            setIsCancellingTransfer(false);
            return;
          }
          
          restockedItems = undeliveredItems;
        }
      }

      const response = await fetch('/api/transfers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferId: selectedTransfer.id,
          status: 'cancelled',
          restockedItems: restockedItems.length > 0 ? restockedItems : undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setTransfers(prev => prev.map(t => t.id === selectedTransfer.id ? data.transfer : t));
        setShowCancelTransferConfirm(false);
        setSelectedTransfer(null);
        
        // Rebuild incoming cache since transfer was removed
        if (['in_transit', 'partial'].includes(selectedTransfer.status)) {
          try {
            await fetch('/api/transfers/inventory', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'rebuild_incoming' }),
            });
            await loadIncomingFromCache();
          } catch (err) {
            console.warn('Failed to rebuild incoming cache:', err);
          }
        }
        
        const restockMessage = restockedItems.length > 0 
          ? ` Undelivered items restocked to ${selectedTransfer.origin}.`
          : '';
        showProdNotification('success', 'Transfer Cancelled', `Transfer ${selectedTransfer.id} has been cancelled.${restockMessage}`);
      } else {
        showProdNotification('error', 'Cancel Failed', data.error || 'Failed to cancel transfer');
      }
    } catch (err) {
      console.error('Failed to cancel transfer:', err);
      showProdNotification('error', 'Cancel Failed', 'Failed to cancel transfer');
    } finally {
      setIsCancellingTransfer(false);
    }
  };

  // Create new production order
  const createProductionOrder = async () => {
    if (isCreatingOrder) return; // Prevent double-clicks
    
    const validItems = newOrderItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({
        sku: item.sku.trim().toUpperCase(),
        quantity: parseInt(item.quantity),
        ...(item.masterCartons && parseInt(item.masterCartons) > 0 ? { masterCartons: parseInt(item.masterCartons) } : {}),
      }));

    if (validItems.length === 0) {
      showProdNotification('error', 'Missing Items', 'Please add at least one item with a valid SKU and quantity');
      return;
    }

    // Validate all SKUs exist in inventory
    const invalidSkus = validItems.filter(item => 
      !inventoryData?.inventory.some(inv => inv.sku.toUpperCase() === item.sku.toUpperCase())
    );
    if (invalidSkus.length > 0) {
      showProdNotification('error', 'Invalid SKU', `SKU${invalidSkus.length > 1 ? 's' : ''} not found: ${invalidSkus.map(i => i.sku).join(', ')}`);
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
        setNewOrderItems([{ sku: '', quantity: '', masterCartons: '' }]);
        setNewOrderNotes('');
        setNewOrderVendor('');
        setNewOrderEta('');
        await loadProductionOrders();
      } else {
        const data = await response.json();
        showProdNotification('error', 'Create Failed', data.error || 'Failed to create order');
      }
    } catch (err) {
      showProdNotification('error', 'Create Failed', 'Failed to create production order');
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
        showProdNotification('success', 'Order Updated', 'Production order updated successfully');
      } else {
        const data = await response.json();
        showProdNotification('error', 'Update Failed', data.error || 'Failed to update order');
      }
    } catch (err) {
      showProdNotification('error', 'Update Failed', 'Failed to update order');
    }
  };

  // Get valid deliveries for production order
  const getValidDeliveries = () => {
    return deliveryItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({ sku: item.sku.trim().toUpperCase(), quantity: parseInt(item.quantity) }));
  };

  // Show order delivery confirmation (first step - validates and shows confirmation modal)
  const showOrderDeliveryConfirmation = () => {
    const validDeliveries = getValidDeliveries();

    if (validDeliveries.length === 0) {
      showProdNotification('error', 'Missing Deliveries', 'Please enter at least one delivery quantity');
      return;
    }

    // Validate all SKUs exist in inventory
    const invalidSkus = validDeliveries.filter(item => 
      !inventoryData?.inventory.some(inv => inv.sku.toUpperCase() === item.sku.toUpperCase())
    );
    if (invalidSkus.length > 0) {
      showProdNotification('error', 'Invalid SKU', `SKU${invalidSkus.length > 1 ? 's' : ''} not found: ${invalidSkus.map(i => i.sku).join(', ')}`);
      return;
    }

    setShowDeliveryConfirm(true);
  };

  // Confirm delivery and update Shopify (second step - actually processes the delivery)
  const confirmDeliveryAndUpdateShopify = async () => {
    if (isLoggingDelivery || !selectedOrder) return;
    
    const validDeliveries = getValidDeliveries();
    
    setIsLoggingDelivery(true);
    setIsUpdatingShopify(true);
    setGlobalStatus({ message: 'Logging Delivery to Shopify...', subMessage: 'Updating inventory counts' });
    
    try {
      // Step 1: Get location ID for the delivery location
      const locationId = inventoryData?.locationIds?.[deliveryLocation];
      if (!locationId) {
        throw new Error(`${deliveryLocation} location ID not found. Please refresh the data.`);
      }

      // Step 2: Build Shopify inventory updates using locationDetails for inventoryItemId
      const locationDetails = inventoryData?.locationDetails?.[deliveryLocation] || [];
      
      const shopifyUpdates = validDeliveries.map(delivery => {
        // Find the item in locationDetails to get inventoryItemId
        const detailItem = locationDetails.find(d => d.sku === delivery.sku);
        if (!detailItem) {
          // Try to find in any location's details
          const allLocations = Object.keys(inventoryData?.locationDetails || {});
          let foundItem = null;
          for (const loc of allLocations) {
            foundItem = inventoryData?.locationDetails?.[loc]?.find(d => d.sku === delivery.sku);
            if (foundItem) break;
          }
          if (!foundItem) {
            throw new Error(`SKU ${delivery.sku} not found in inventory data. Please refresh the data.`);
          }
          // Use the found item's inventoryItemId
          const currentQty = inventoryData?.inventory.find(i => i.sku === delivery.sku)?.locations[deliveryLocation] || 0;
          return {
            sku: delivery.sku,
            inventoryItemId: foundItem.inventoryItemId,
            quantity: currentQty + delivery.quantity,
            locationId,
          };
        }
        
        // Get current quantity at the delivery location
        const currentQty = detailItem.onHand || 0;
        
        return {
          sku: delivery.sku,
          inventoryItemId: detailItem.inventoryItemId,
          quantity: currentQty + delivery.quantity, // Add to existing quantity
          locationId,
        };
      });

      // Step 3: Update Shopify inventory
      const shopifyResponse = await fetch('/api/inventory/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: shopifyUpdates,
          reason: `PO Delivery - ${selectedOrder.id}`,
        }),
      });

      if (!shopifyResponse.ok) {
        const shopifyError = await shopifyResponse.json();
        throw new Error(shopifyError.error || 'Failed to update Shopify inventory');
      }

      const shopifyResult = await shopifyResponse.json();
      
      if (shopifyResult.summary.failed > 0) {
        showProdNotification('warning', 'Partial Update', 
          `${shopifyResult.summary.success} SKUs updated in Shopify, ${shopifyResult.summary.failed} failed`);
      }

      // Step 4: Update production order in our system
      const response = await fetch('/api/production-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          orderId: selectedOrder.id, 
          deliveries: validDeliveries,
          deliveryLocation,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setShowDeliveryConfirm(false);
        setShowDeliveryForm(false);
        setDeliveryItems([]);
        setDeliveryLocation('China WH');
        setSelectedOrder(data.order);
        await loadProductionOrders();
        showProdNotification('success', 'Delivery Logged', 
          `Delivery recorded and ${shopifyResult.summary.success} SKUs updated in Shopify at ${deliveryLocation}`);
      } else {
        const data = await response.json();
        showProdNotification('error', 'Log Failed', data.error || 'Failed to log delivery');
      }
    } catch (err) {
      console.error('Delivery error:', err);
      showProdNotification('error', 'Delivery Failed', err instanceof Error ? err.message : 'Failed to process delivery');
    } finally {
      setGlobalStatus(null);
      setIsLoggingDelivery(false);
      setIsUpdatingShopify(false);
    }
  };

  // Save edited production order
  const saveEditOrder = async (orderId: string) => {
    if (isSavingOrder) return; // Prevent double-clicks
    
    const validItems = editOrderItems
      .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
      .map(item => ({
        sku: item.sku.trim().toUpperCase(),
        quantity: parseInt(item.quantity),
        ...(item.masterCartons && parseInt(item.masterCartons) > 0 ? { masterCartons: parseInt(item.masterCartons) } : {}),
      }));

    if (validItems.length === 0) {
      showProdNotification('error', 'Missing Items', 'Please add at least one item with a valid SKU and quantity');
      return;
    }

    // Validate all SKUs exist in inventory
    const invalidSkus = validItems.filter(item => 
      !inventoryData?.inventory.some(inv => inv.sku.toUpperCase() === item.sku.toUpperCase())
    );
    if (invalidSkus.length > 0) {
      showProdNotification('error', 'Invalid SKU', `SKU${invalidSkus.length > 1 ? 's' : ''} not found: ${invalidSkus.map(i => i.sku).join(', ')}`);
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
          eta: editOrderEta || null, // Use null to allow clearing, undefined would be excluded by JSON.stringify
          notes: editOrderNotes,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setShowEditForm(false);
        setSelectedOrder(data.order);
        showProdNotification('success', 'Order Updated', 'Production order updated successfully');
        // Refresh data after showing notification to avoid delay
        await loadProductionOrders();
      } else {
        const data = await response.json();
        showProdNotification('error', 'Update Failed', data.error || 'Failed to update order');
      }
    } catch (err) {
      showProdNotification('error', 'Update Failed', 'Failed to update order');
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
        showProdNotification('success', 'Order Cancelled', 'Production order has been cancelled');
      } else {
        const data = await response.json();
        showProdNotification('error', 'Cancel Failed', data.error || 'Failed to cancel order');
      }
    } catch (err) {
      showProdNotification('error', 'Cancel Failed', 'Failed to cancel order');
    } finally {
      setIsCancellingOrder(false);
    }
  };

  // Refresh all data from Shopify (called when user clicks Refresh button)
  const refreshAllData = async (isAutoRefresh = false) => {
    setIsRefreshing(true);
    setInventoryError(null);
    setForecastingError(null);
    if (!isAutoRefresh) {
      setGlobalStatus({ message: 'Refreshing Data from Shopify...', subMessage: 'This may take up to 30 seconds' });
    }
    try {
      const headers: HeadersInit = {};
      if (isAutoRefresh) {
        headers['x-auto-refresh'] = 'true';
      }
      const response = await fetch('/api/refresh', { headers });
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
      setGlobalStatus(null);
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
      if (transfers.length === 0 && !transfersLoading) loadTransfers();
    }
  }, [activeTab]);

  // Initial load from cache
  useEffect(() => {
    loadInventoryFromCache();
    loadProductionOrders(); // Also load PO data for Planning tab
    loadPhaseOutSkus(); // Load phase out list
    loadHiddenSkus(); // Load hidden SKUs list for Inventory Counts tab
    loadSkuComments(); // Load SKU comments
    loadMcData(); // Load MC data
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

  // Close product dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(event.target as Node)) {
        setShowProductDropdown(false);
      }
    };
    if (showProductDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProductDropdown]);

  // Close SKU search suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (skuSearchRef.current && !skuSearchRef.current.contains(event.target as Node)) {
        setShowSkuSearchSuggestions(false);
      }
    };
    if (showSkuSearchSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSkuSearchSuggestions]);

  // Close inventory product dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (inventoryProductDropdownRef.current && !inventoryProductDropdownRef.current.contains(event.target as Node)) {
        setShowInventoryProductDropdown(false);
      }
    };
    if (showInventoryProductDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showInventoryProductDropdown]);

  // Close tracker product dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (trackerProductDropdownRef.current && !trackerProductDropdownRef.current.contains(event.target as Node)) {
        setShowTrackerProductDropdown(false);
      }
    };
    if (showTrackerProductDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTrackerProductDropdown]);

  // Close search suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchSuggestions(false);
      }
      if (locationSearchRef.current && !locationSearchRef.current.contains(event.target as Node)) {
        setShowLocationSearchSuggestions(false);
      }
      if (forecastSearchRef.current && !forecastSearchRef.current.contains(event.target as Node)) {
        setShowForecastSearchSuggestions(false);
      }
      if (planningSearchRef.current && !planningSearchRef.current.contains(event.target as Node)) {
        setShowPlanningSearchSuggestions(false);
      }
      if (trackerSearchRef.current && !trackerSearchRef.current.contains(event.target as Node)) {
        setShowTrackerSearchSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Global ESC key handler to close modals
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Close modals in priority order (confirmations first, then forms)
        if (showLogDeliveryConfirm) {
          setShowLogDeliveryConfirm(false);
        } else if (showMarkInTransitConfirm) {
          setShowMarkInTransitConfirm(false);
          setTransferToMarkInTransit(null);
        } else if (showImmediateTransferConfirm) {
          setShowImmediateTransferConfirm(false);
          setPendingImmediateTransfer(null);
        } else if (showDeliveryConfirm) {
          setShowDeliveryConfirm(false);
        } else if (showCancelConfirm) {
          setShowCancelConfirm(false);
        } else if (showCancelTransferConfirm) {
          setShowCancelTransferConfirm(false);
        } else if (showTrackerConfirm) {
          setShowTrackerConfirm(false);
        } else if (showTrackerClearConfirm) {
          setShowTrackerClearConfirm(false);
        } else if (showTransferDeliveryForm) {
          setShowTransferDeliveryForm(false);
        } else if (showDeliveryForm) {
          setShowDeliveryForm(false);
        } else if (showEditTransferForm) {
          setShowEditTransferForm(false);
        } else if (showEditForm) {
          setShowEditForm(false);
        } else if (showNewTransferForm) {
          setShowNewTransferForm(false);
        } else if (showNewOrderForm) {
          setShowNewOrderForm(false);
        } else if (showColumnDefinitions) {
          setShowColumnDefinitions(false);
        } else if (showOverviewColumnDefinitions) {
          setShowOverviewColumnDefinitions(false);
        } else if (showPhaseOutModal) {
          setShowPhaseOutModal(false);
        } else if (showHiddenSkusModal) {
          setShowHiddenSkusModal(false);
        } else if (showSkuCommentForm) {
          setShowSkuCommentForm(false);
        } else if (showTrackerLogs) {
          setShowTrackerLogs(false);
        }
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [
    showLogDeliveryConfirm, showMarkInTransitConfirm, showImmediateTransferConfirm,
    showDeliveryConfirm, showCancelConfirm, showCancelTransferConfirm,
    showTrackerConfirm, showTrackerClearConfirm, showTransferDeliveryForm,
    showDeliveryForm, showEditTransferForm, showEditForm, showNewTransferForm,
    showNewOrderForm, showColumnDefinitions, showOverviewColumnDefinitions, showPhaseOutModal, showHiddenSkusModal, showSkuCommentForm, showTrackerLogs
  ]);

  // Load tracker drafts and last submission info from Google Drive on mount
  useEffect(() => {
    const loadAllDraftsAndSubmissions = async () => {
      setIsLoadingDraft(true);
      const locations: TrackerLocation[] = ['LA Office', 'DTLA WH', 'China WH'];
      
      try {
        // First check localStorage for any unsaved work
        for (const loc of locations) {
          const localKey = `trackerCounts_${loc.replace(/\s/g, '_')}`;
          const localSaved = localStorage.getItem(localKey);
          if (localSaved) {
            try {
              setTrackerCounts(prev => ({
                ...prev,
                [loc]: JSON.parse(localSaved),
              }));
            } catch (e) {
              console.error(`Failed to load local counts for ${loc}:`, e);
            }
          }
        }
        
        // Then try to load shared drafts and last submission from Google Drive for each location
        for (const loc of locations) {
          let hasDraft = false;
          
          // Load shared draft (auto-merged from all contributors)
          try {
            const response = await fetch(`/api/warehouse/draft?location=${encodeURIComponent(loc)}`);
            if (response.ok) {
              const data = await response.json();
              if (data.currentUser) {
                setCurrentUserName(data.currentUser);
              }
              const localKey = `trackerCounts_${loc.replace(/\s/g, '_')}`;
              
              if (data.draft) {
                hasDraft = true;
                const localSaved = localStorage.getItem(localKey);
                const localCounts = localSaved ? JSON.parse(localSaved) : {};
                
                // Always load the shared draft counts (merged from all contributors)
                // Merge with any local unsaved work
                const mergedCounts = { ...data.draft.counts };
                for (const [sku, value] of Object.entries(localCounts)) {
                  if (value !== null && !mergedCounts[sku]) {
                    mergedCounts[sku] = value;
                  }
                }
                
                setTrackerCounts(prev => ({
                  ...prev,
                  [loc]: mergedCounts,
                }));
                localStorage.setItem(localKey, JSON.stringify(mergedCounts));
                
                setTrackerDraftInfo(prev => ({
                  ...prev,
                  [loc]: { savedAt: data.draft.savedAt, savedBy: data.draft.savedBy },
                }));
                
                // Store count details and contributors for the current location
                if (loc === 'LA Office') {
                  setCountDetails(data.draft.countDetails || {});
                  setDraftContributors(data.draft.contributors || []);
                }
              } else {
                // No draft on server - clear local counts (draft was cleared by someone)
                setTrackerCounts(prev => ({
                  ...prev,
                  [loc]: {},
                }));
                localStorage.removeItem(localKey);
                setTrackerDraftInfo(prev => ({
                  ...prev,
                  [loc]: null,
                }));
              }
            }
          } catch (error) {
            console.error(`Failed to load draft for ${loc}:`, error);
          }
          
          // If no draft, load the most recent submission from logs
          if (!hasDraft) {
            try {
              const logsResponse = await fetch(`/api/warehouse/logs?location=${encodeURIComponent(loc)}`);
              if (logsResponse.ok) {
                const logsData = await logsResponse.json();
                const logs = logsData.logs || [];
                // Get the most recent submission (first in the array)
                const lastSubmission = logs[0];
                if (lastSubmission) {
                  // Check if it was a test submission
                  const isTest = lastSubmission.testMode || lastSubmission.submittedBy?.startsWith('[TEST]');
                  setTrackerLastSubmission(prev => ({
                    ...prev,
                    [loc]: {
                      submittedAt: lastSubmission.timestamp,
                      submittedBy: lastSubmission.submittedBy?.replace('[TEST] ', '') || 'Unknown',
                      skuCount: lastSubmission.updates?.length || 0,
                      isTest: isTest,
                    },
                  }));
                }
              }
            } catch (error) {
              console.error(`Failed to load logs for ${loc}:`, error);
            }
          }
        }
      } finally {
        setIsLoadingDraft(false);
      }
    };
    loadAllDraftsAndSubmissions();
  }, []);

  // Load shared draft when tracker location changes
  useEffect(() => {
    if (activeTab === 'warehouse') {
      loadSharedDraft(trackerLocation);
    }
  }, [trackerLocation, activeTab]);

  // Save tracker counts to localStorage when changed (for auto-save on blur)
  const saveTrackerCount = (location: TrackerLocation, sku: string, count: number | null) => {
    setTrackerCounts(prev => {
      const updated = {
        ...prev,
        [location]: { ...prev[location], [sku]: count },
      };
      const localKey = `trackerCounts_${location.replace(/\s/g, '_')}`;
      localStorage.setItem(localKey, JSON.stringify(updated[location]));
      return updated;
    });
  };

  // Load shared draft for a location
  const loadSharedDraft = async (location: TrackerLocation) => {
    try {
      const response = await fetch(`/api/warehouse/draft?location=${encodeURIComponent(location)}`);
      if (response.ok) {
        const data = await response.json();
        const localKey = `trackerCounts_${location.replace(/\s/g, '_')}`;
        
        if (data.currentUser) {
          setCurrentUserName(data.currentUser);
        }
        if (data.draft) {
          // Update counts with merged draft from server
          setTrackerCounts(prev => ({
            ...prev,
            [location]: data.draft.counts,
          }));
          localStorage.setItem(localKey, JSON.stringify(data.draft.counts));
          
          setTrackerDraftInfo(prev => ({
            ...prev,
            [location]: { savedAt: data.draft.savedAt, savedBy: data.draft.savedBy },
          }));
          setCountDetails(data.draft.countDetails || {});
          setDraftContributors(data.draft.contributors || []);
        } else {
          // No draft on server - clear local counts (draft was cleared by someone)
          setTrackerCounts(prev => ({
            ...prev,
            [location]: {},
          }));
          localStorage.removeItem(localKey);
          setTrackerDraftInfo(prev => ({
            ...prev,
            [location]: null,
          }));
          setCountDetails({});
          setDraftContributors([]);
        }
      }
    } catch (error) {
      console.error('Failed to load shared draft:', error);
    }
  };

  // Save draft to Google Drive for specific location (auto-merges with existing)
  const saveDraftToGoogleDrive = async (location: TrackerLocation) => {
    setIsSavingDraft(true);
    try {
      const counts = trackerCounts[location];
      const response = await fetch('/api/warehouse/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counts, location }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save draft');
      }
      
      const result = await response.json();
      
      // Update local state with merged counts from server
      if (result.mergedCounts) {
        setTrackerCounts(prev => ({
          ...prev,
          [location]: result.mergedCounts,
        }));
        const localKey = `trackerCounts_${location.replace(/\s/g, '_')}`;
        localStorage.setItem(localKey, JSON.stringify(result.mergedCounts));
      }
      
      setTrackerDraftInfo(prev => ({
        ...prev,
        [location]: { savedAt: result.savedAt, savedBy: result.savedBy },
      }));
      
      if (result.countDetails) {
        setCountDetails(result.countDetails);
      }
      if (result.contributors) {
        setDraftContributors(result.contributors);
      }
      
      // Clear last submission info when a new draft is saved
      setTrackerLastSubmission(prev => ({ ...prev, [location]: null }));
      
      const contributorCount = result.contributors?.length || 1;
      showTrackerNotification('success', 'Draft Saved & Merged', 
        `${result.skuCount} SKUs total from ${contributorCount} contributor${contributorCount !== 1 ? 's' : ''}.`);
    } catch (error) {
      console.error('Failed to save draft:', error);
      showTrackerNotification('error', 'Save Failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Load logs from Google Drive for specific location
  const loadTrackerLogs = async (location: TrackerLocation) => {
    setIsLoadingLogs(true);
    try {
      const response = await fetch(`/api/warehouse/logs?location=${encodeURIComponent(location)}`);
      if (response.ok) {
        const data = await response.json();
        setTrackerLogs(data.logs || []);
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setIsLoadingLogs(false);
    }
  };
  
  // Export log entry to Excel/CSV
  const exportLogToExcel = (log: typeof trackerLogs[0], location: string) => {
    const logDate = new Date(log.timestamp);
    const timestamp = `${logDate.getFullYear()}${String(logDate.getMonth() + 1).padStart(2, '0')}${String(logDate.getDate()).padStart(2, '0')}-${String(logDate.getHours() % 12 || 12).padStart(2, '0')}${String(logDate.getMinutes()).padStart(2, '0')}${logDate.getHours() >= 12 ? 'PM' : 'AM'}`;
    const filename = `inventory-counts-${location.replace(/\s/g, '-')}-${timestamp}.csv`;
    
    // Build CSV content
    const headers = ['SKU', 'Previous On Hand', 'New Quantity', 'Change'];
    const rows = log.updates.map(u => [
      u.sku,
      u.previousOnHand,
      u.newQuantity,
      u.newQuantity - u.previousOnHand,
    ]);
    
    const csvContent = [
      `Inventory Count Submission - ${location}`,
      `Submitted: ${new Date(log.timestamp).toLocaleString()}`,
      `Submitted By: ${log.submittedBy}`,
      `Total SKUs: ${log.summary.totalSKUs}`,
      `Discrepancies: ${log.summary.discrepancies}`,
      `Total Difference: ${log.summary.totalDifference}`,
      '',
      headers.join(','),
      ...rows.map(r => r.join(',')),
    ].join('\n');
    
    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Parse date string as local time (fixes timezone offset issue for date-only strings like "2025-02-15")
  const parseLocalDate = (dateStr: string): Date => {
    // If it's a date-only string (YYYY-MM-DD), parse as local time to avoid timezone shift
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    // Otherwise use standard Date parsing
    return new Date(dateStr);
  };

  // Format date for badges: "Jan 25, 2026, 10:48AM"
  const formatBadgeDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    const year = date.getFullYear();
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${month} ${day}, ${year}, ${hour12}:${minutes}${ampm}`;
  };

  // Show tracker notification
  const showTrackerNotification = (type: 'success' | 'error' | 'warning', title: string, message: string) => {
    setTrackerNotification({ type, title, message });
    // Auto-dismiss after 5 seconds for success, 8 seconds for errors
    setTimeout(() => setTrackerNotification(null), type === 'error' ? 8000 : 5000);
  };

  // Show production/transfers notification
  const showProdNotification = (type: 'success' | 'error' | 'warning', title: string, message: string) => {
    setProdNotification({ type, title, message });
    // Auto-dismiss after 5 seconds for success, 8 seconds for errors
    setTimeout(() => setProdNotification(null), type === 'error' ? 8000 : 5000);
  };

  // Clear tracker counts for current location (clears for everyone)
  const clearTrackerCounts = async (location: TrackerLocation) => {
    // Use startTransition to prevent blocking the UI
    startTransition(() => {
      setTrackerCounts(prev => ({
        ...prev,
        [location]: {},
      }));
    });
    const localKey = `trackerCounts_${location.replace(/\s/g, '_')}`;
    localStorage.removeItem(localKey);
    setShowTrackerClearConfirm(false);
    
    // Delete shared draft from Google Drive (clears for everyone)
    try {
      const deleteResponse = await fetch(`/api/warehouse/draft?location=${encodeURIComponent(location)}`, { method: 'DELETE' });
      if (deleteResponse.ok) {
        showTrackerNotification('success', 'Draft Cleared', `All counts for ${location} have been cleared for everyone.`);
      } else {
        const errorData = await deleteResponse.json();
        console.error('Delete draft failed:', errorData);
        showTrackerNotification('error', 'Clear Failed', errorData.error || 'Failed to clear the shared draft.');
      }
    } catch (error) {
      console.error('Failed to delete draft:', error);
      showTrackerNotification('error', 'Clear Failed', 'Failed to clear the shared draft.');
    }
    
    // Clear draft info and contributor data
    setTrackerDraftInfo(prev => ({ ...prev, [location]: null }));
    setDraftContributors([]);
    setCountDetails({});
    
    // Load the last submission from logs to show in badge
    try {
      const logsResponse = await fetch(`/api/warehouse/logs?location=${encodeURIComponent(location)}`);
      if (logsResponse.ok) {
        const logsData = await logsResponse.json();
        const logs = logsData.logs || [];
        const lastSubmission = logs[0];
        if (lastSubmission) {
          const isTest = lastSubmission.testMode || lastSubmission.submittedBy?.startsWith('[TEST]');
          setTrackerLastSubmission(prev => ({
            ...prev,
            [location]: {
              submittedAt: lastSubmission.timestamp,
              submittedBy: lastSubmission.submittedBy?.replace('[TEST] ', '') || 'Unknown',
              skuCount: lastSubmission.updates?.length || 0,
              isTest: isTest,
            },
          }));
        }
      }
    } catch (error) {
      console.error('Failed to load last submission:', error);
    }
  };

  // Helper to calculate inventory for selected locations
  const getInventoryForLocations = (inventoryItem: InventoryByLocation | undefined, selectedLocations: string[]): number => {
    if (!inventoryItem) return 0;
    if (selectedLocations.includes('all')) return inventoryItem.totalAvailable;
    return selectedLocations.reduce((sum, loc) => sum + (inventoryItem.locations[loc] || 0), 0);
  };

  // Helper to calculate Total for Overview tab
  // Total = LA Office + DTLA WH + China WH + In Transit (excludes ShipBob)
  const calculateOverviewTotal = (item: InventoryByLocation, inTransit: number): number => {
    const laOffice = item.locations['LA Office'] || 0;
    const dtlaWh = item.locations['DTLA WH'] || 0;
    const chinaWh = item.locations['China WH'] || 0;
    return laOffice + dtlaWh + chinaWh + inTransit;
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

  // Extract product model from SKU - must be defined before filteredInventory uses it
  const extractProductModel = (productTitle: string, sku: string): string => {
    // Guard against null/undefined values
    if (!sku) return productTitle || 'Unknown Product';
    if (!productTitle) productTitle = '';
    
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

    // Tesla Charger (MBT prefix, ADT prefix, CTC-BKC)
    if (/^MBT/i.test(skuUpper) || /^ADT/i.test(skuUpper) || skuUpper === 'CTC-BKC') {
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

    // AirPods Cases (MBAPP prefix or title contains "AirPods")
    if (/^MBAPP/i.test(skuUpper) || /airpods/i.test(productTitle)) {
      return 'AirPods Cases';
    }

    // For other products, use a simplified title (first 30 chars or up to first dash/pipe)
    const simplified = productTitle.split(/[-|]/)[0].trim();
    return simplified.length > 40 ? simplified.substring(0, 40) + '...' : simplified;
  };

  // Sort SKUs within a group - special handling for Tesla Charger category
  const sortSkusInGroup = <T extends { sku: string }>(items: T[], groupName: string): T[] => {
    const shouldReverseSort = groupName === 'Screen Protectors' || groupName === 'Lens Protectors';
    
    // Special sort order for Tesla Charger group
    if (groupName === 'Tesla Charger') {
      // Priority SKUs in specific order
      const priorityOrder = ['MBT3Y-DG', 'MBT3YRH-DG', 'CTC-BKC', 'ADT24-L', 'ADTCT-L'];
      
      return [...items].sort((a, b) => {
        const aUpper = a.sku.toUpperCase();
        const bUpper = b.sku.toUpperCase();
        
        const aIndex = priorityOrder.findIndex(p => p.toUpperCase() === aUpper);
        const bIndex = priorityOrder.findIndex(p => p.toUpperCase() === bUpper);
        
        // Both are priority SKUs - sort by priority order
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        // Only a is priority - a comes first
        if (aIndex !== -1) return -1;
        // Only b is priority - b comes first
        if (bIndex !== -1) return 1;
        
        // Neither are priority - sort by prefix then alphabetically
        const aStartsMB = aUpper.startsWith('MB');
        const bStartsMB = bUpper.startsWith('MB');
        const aStartsAD = aUpper.startsWith('AD');
        const bStartsAD = bUpper.startsWith('AD');
        
        // MB comes before AD
        if (aStartsMB && bStartsAD) return -1;
        if (aStartsAD && bStartsMB) return 1;
        
        // Same prefix or neither - alphabetical
        return aUpper.localeCompare(bUpper);
      });
    }
    
    // Default sort: reverse for protectors, alphabetical otherwise
    return [...items].sort((a, b) => 
      shouldReverseSort ? b.sku.localeCompare(a.sku) : a.sku.localeCompare(b.sku)
    );
  };

  // Get incoming data from our local transfers (not Shopify) - declare before filteredInventory uses it
  const incomingFromTransfersData = getIncomingFromTransfers();

  // Filter and sort inventory
  const filteredInventory = inventoryData?.inventory
    .filter(item => {
      // Guard against items with missing SKU
      if (!item.sku) return false;
      
      // Phase out filter: hide phased out SKUs with zero displayed inventory
      // Use same calculation as displayed Total (LA + DTLA + China + In Transit, excludes ShipBob)
      const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
      if (isPhaseOut) {
        let inTransit = 0;
        for (const [, skuData] of Object.entries(incomingFromTransfersData)) {
          const skuIncoming = skuData[item.sku];
          if (skuIncoming) {
            inTransit += skuIncoming.inboundAir + skuIncoming.inboundSea;
          }
        }
        const displayedTotal = calculateOverviewTotal(item, inTransit);
        if (displayedTotal <= 0) return false;
      }
      
      const matchesSearch = !searchTerm || 
        item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.productTitle || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.variantTitle || '').toLowerCase().includes(searchTerm.toLowerCase());
      if (filterOutOfStock && item.totalAvailable > 0) return false;
      if (filterLowStock && (item.totalAvailable <= 0 || item.totalAvailable > 10)) return false;
      // Filter by product group (multi-select)
      if (inventoryFilterProducts.length > 0) {
        const itemProductGroup = extractProductModel(item.productTitle, item.sku);
        if (!inventoryFilterProducts.includes(itemProductGroup)) return false;
      }
      // Filter by location if location filters are set
      if (inventoryLocationFilters.length > 0) {
        // Item must have qty > 0 in at least one selected location
        const hasQtyInSelectedLocation = inventoryLocationFilters.some(loc => (item.locations[loc] || 0) > 0);
        if (!hasQtyInSelectedLocation) return false;
      }
      return matchesSearch;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'sku') {
        comparison = a.sku.localeCompare(b.sku);
      } else if (sortBy === 'total') {
        comparison = a.totalAvailable - b.totalAvailable;
      } else if (sortBy === 'inTransit') {
        // Sort by total in transit (In Air + In Sea from local transfers)
        const getInTransit = (sku: string) => {
          let total = 0;
          for (const [, skuData] of Object.entries(incomingFromTransfersData)) {
            const skuIncoming = skuData[sku];
            if (skuIncoming) {
              total += skuIncoming.inboundAir + skuIncoming.inboundSea;
            }
          }
          return total;
        };
        comparison = getInTransit(a.sku) - getInTransit(b.sku);
      } else {
        // Sort by location quantity
        const aQty = a.locations[sortBy] || 0;
        const bQty = b.locations[sortBy] || 0;
        comparison = aQty - bQty;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    }) || [];

  // Filter and sort location detail
  // Show detail view when any locations are selected (single or multiple) or when modal is open
  const showLocationDetailView = inventoryLocationFilters.length > 0 || selectedLocation !== null;
  // For modal, use selectedLocation; for inline, use first selected location (for single) or aggregate (for multiple)
  const activeLocationFilter = selectedLocation || (inventoryLocationFilters.length === 1 ? inventoryLocationFilters[0] : null);
  
  // Build aggregated location detail when locations are selected
  const filteredLocationDetail = (() => {
    // Modal view - single location
    if (selectedLocation && inventoryData?.locationDetails?.[selectedLocation]) {
      return inventoryData.locationDetails[selectedLocation]
        .map(item => {
          const localIncoming = incomingFromTransfersData[selectedLocation]?.[item.sku];
          if (localIncoming) {
            return {
              ...item,
              incoming: localIncoming.inboundAir + localIncoming.inboundSea,
              inboundAir: localIncoming.inboundAir,
              inboundSea: localIncoming.inboundSea,
              airTransfers: localIncoming.airTransfers,
              seaTransfers: localIncoming.seaTransfers,
            };
          }
          return { ...item, incoming: 0, inboundAir: 0, inboundSea: 0, airTransfers: [], seaTransfers: [] };
        })
        .filter(item => {
          const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
          if (isPhaseOut && item.available <= 0) return false;
          const matchesSearch = !locationSearchTerm || 
            item.sku.toLowerCase().includes(locationSearchTerm.toLowerCase()) ||
            item.productTitle.toLowerCase().includes(locationSearchTerm.toLowerCase()) ||
            item.variantTitle.toLowerCase().includes(locationSearchTerm.toLowerCase());
          return matchesSearch;
        })
        .sort((a, b) => {
          let comparison = 0;
          if (locationSortBy === 'sku') comparison = a.sku.localeCompare(b.sku);
          else comparison = a[locationSortBy] - b[locationSortBy];
          return locationSortOrder === 'asc' ? comparison : -comparison;
        });
    }
    
    // Inline view - single location selected
    if (inventoryLocationFilters.length === 1 && inventoryData?.locationDetails?.[inventoryLocationFilters[0]]) {
      const loc = inventoryLocationFilters[0];
      return inventoryData.locationDetails[loc]
        .map(item => {
          const localIncoming = incomingFromTransfersData[loc]?.[item.sku];
          if (localIncoming) {
            return {
              ...item,
              incoming: localIncoming.inboundAir + localIncoming.inboundSea,
              inboundAir: localIncoming.inboundAir,
              inboundSea: localIncoming.inboundSea,
              airTransfers: localIncoming.airTransfers,
              seaTransfers: localIncoming.seaTransfers,
            };
          }
          return { ...item, incoming: 0, inboundAir: 0, inboundSea: 0, airTransfers: [], seaTransfers: [] };
        })
        .filter(item => {
          const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
          if (isPhaseOut && item.available <= 0) return false;
          const matchesSearch = !searchTerm || 
            item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.productTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.variantTitle.toLowerCase().includes(searchTerm.toLowerCase());
          if (filterOutOfStock && item.available > 0) return false;
          if (filterLowStock && (item.available <= 0 || item.available > 10)) return false;
          if (inventoryFilterProducts.length > 0) {
            const itemProductGroup = extractProductModel(item.productTitle, item.sku);
            if (!inventoryFilterProducts.includes(itemProductGroup)) return false;
          }
          return matchesSearch;
        })
        .sort((a, b) => {
          let comparison = 0;
          if (locationSortBy === 'sku') comparison = a.sku.localeCompare(b.sku);
          else comparison = a[locationSortBy] - b[locationSortBy];
          return locationSortOrder === 'asc' ? comparison : -comparison;
        });
    }
    
    // Inline view - multiple locations selected: aggregate data
    if (inventoryLocationFilters.length > 1 && inventoryData) {
      // Get all unique SKUs from selected locations
      const skuMap = new Map<string, {
        sku: string;
        productTitle: string;
        variantTitle: string;
        inventoryItemId: string;
        onHand: number;
        available: number;
        committed: number;
        inboundAir: number;
        inboundSea: number;
        incoming: number;
        airTransfers: TransferDetail[];
        seaTransfers: TransferDetail[];
      }>();
      
      for (const loc of inventoryLocationFilters) {
        const locDetails = inventoryData.locationDetails?.[loc] || [];
        for (const item of locDetails) {
          const existing = skuMap.get(item.sku);
          const localIncoming = incomingFromTransfersData[loc]?.[item.sku];
          const inboundAir = localIncoming?.inboundAir || 0;
          const inboundSea = localIncoming?.inboundSea || 0;
          
          if (existing) {
            existing.onHand += item.onHand;
            existing.available += item.available;
            existing.committed += item.committed;
            existing.inboundAir += inboundAir;
            existing.inboundSea += inboundSea;
            existing.incoming += inboundAir + inboundSea;
            if (localIncoming?.airTransfers) existing.airTransfers.push(...localIncoming.airTransfers);
            if (localIncoming?.seaTransfers) existing.seaTransfers.push(...localIncoming.seaTransfers);
          } else {
            skuMap.set(item.sku, {
              sku: item.sku,
              productTitle: item.productTitle,
              variantTitle: item.variantTitle,
              inventoryItemId: item.inventoryItemId,
              onHand: item.onHand,
              available: item.available,
              committed: item.committed,
              inboundAir,
              inboundSea,
              incoming: inboundAir + inboundSea,
              airTransfers: localIncoming?.airTransfers ? [...localIncoming.airTransfers] : [],
              seaTransfers: localIncoming?.seaTransfers ? [...localIncoming.seaTransfers] : [],
            });
          }
        }
      }
      
      return Array.from(skuMap.values())
        .filter(item => {
          const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
          if (isPhaseOut && item.available <= 0) return false;
          const matchesSearch = !searchTerm || 
            item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.productTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.variantTitle.toLowerCase().includes(searchTerm.toLowerCase());
          if (filterOutOfStock && item.available > 0) return false;
          if (filterLowStock && (item.available <= 0 || item.available > 10)) return false;
          if (inventoryFilterProducts.length > 0) {
            const itemProductGroup = extractProductModel(item.productTitle, item.sku);
            if (!inventoryFilterProducts.includes(itemProductGroup)) return false;
          }
          return matchesSearch;
        })
        .sort((a, b) => {
          let comparison = 0;
          if (locationSortBy === 'sku') comparison = a.sku.localeCompare(b.sku);
          else comparison = a[locationSortBy] - b[locationSortBy];
          return locationSortOrder === 'asc' ? comparison : -comparison;
        });
    }
    
    return [];
  })();

  // Filter and sort forecasting
  // Build a set of valid SKUs from inventory (products tagged "inventoried")
  const inventoriedSkus = new Set(inventoryData?.inventory.map(item => item.sku) || []);

  const filteredForecasting = mergedForecastingData
    .filter(item => {
      // Only show SKUs that exist in inventory (products tagged "inventoried")
      if (!inventoriedSkus.has(item.sku)) return false;
      
      // Phase out filter: hide phased out SKUs with zero total inventory
      const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
      if (isPhaseOut && item.totalInventory <= 0) return false;
      
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

  // Format transfer tooltip
  const formatTransferTooltip = (transfers: TransferDetail[] | undefined): string | undefined => {
    if (!transfers || transfers.length === 0) return undefined;
    const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return transfers.map(t => {
      const lines = [];
      const createdDate = t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-US', dateOpts) : '';
      const etaStr = t.expectedArrivalAt ? ` | ETA: ${parseLocalDate(t.expectedArrivalAt).toLocaleDateString('en-US', dateOpts)}` : '';
      lines.push(`${t.name}${etaStr}`);
      lines.push(`Created: ${createdDate}`);
      const tagsStr = Array.isArray(t.tags) ? t.tags.join(', ') : '';
      lines.push(`Qty: ${t.quantity}${tagsStr ? ` - ${tagsStr}` : ''}`);
      return lines.join('\n');
    }).join('\n\n');
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

  // Format activity log text to show SKU items on separate lines and handle notes
  const formatActivityLogText = (text: string): React.ReactNode => {
    // First check if text contains newlines (e.g., notes on separate line)
    const lines = text.split('\n');
    
    // Process first line for SKU patterns
    const firstLine = lines[0];
    const skuPattern = /([A-Z0-9-]+)\s*→\s*(\d+)/g;
    const matches = [...firstLine.matchAll(skuPattern)];
    
    // Get any additional lines (like notes)
    const additionalLines = lines.slice(1).filter(line => line.trim());
    
    if (matches.length > 1) {
      // Multiple SKUs - format as list
      // Find where the SKU list starts
      const firstMatch = matches[0];
      const prefix = firstLine.substring(0, firstMatch.index).replace(/:\s*$/, '');
      
      return (
        <span>
          {prefix && <>{prefix}:</>}
          <span className="block pl-2 mt-1">
            {matches.map((match, idx) => (
              <span key={idx} className="block">- {match[1]} → {match[2]}</span>
            ))}
          </span>
          {additionalLines.map((line, idx) => (
            <span key={`line-${idx}`} className="block mt-1">{line}</span>
          ))}
        </span>
      );
    }
    
    // Single or no SKU items - handle newlines if present
    if (additionalLines.length > 0) {
      return (
        <span>
          <span>{firstLine}</span>
          {additionalLines.map((line, idx) => (
            <span key={`line-${idx}`} className="block mt-1">{line}</span>
          ))}
        </span>
      );
    }
    
    // Single line, return as-is
    return text;
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
    if (groupName === 'Chargers') return -20;
    if (groupName === 'Tesla Charger') return -30;
    if (groupName === 'RimCase') return -40;
    if (groupName === 'KeyTag') return -50;
    if (groupName === 'MagSticks') return -60;
    if (groupName === 'Color Accessories') return -70;
    if (groupName === 'Lens Protectors') return -80;
    if (groupName === 'Screen Protectors') return -90;
    if (groupName === 'Wrist Straps') return -100;
    if (groupName === 'AirPods Cases') return -110;
    
    // Other products - at the end
    return -120;
  };

  // Sort group names by revenue priority (higher priority = first)
  const sortedGroupNames = Object.keys(groupedInventory).sort((a, b) => {
    return getModelPriority(b) - getModelPriority(a);
  });

  // Get all product groups from UNFILTERED inventory for the dropdown (so options don't disappear when filtering)
  const allInventoryProductGroups = [...new Set(
    (inventoryData?.inventory || []).map(item => extractProductModel(item.productTitle || '', item.sku || ''))
  )].sort((a, b) => getModelPriority(b) - getModelPriority(a));

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

  // Column definitions for Overview tab
  const overviewColumnDefinitions = [
    { name: 'SKU', description: 'Product SKU identifier' },
    { name: 'Location Columns', description: 'Available inventory at each warehouse location (LA Office, DTLA WH, ShipBob, China WH).\n\nClick a location card above to filter and see detailed breakdown (On Hand, Available, Committed).' },
    { name: 'On Hand', description: 'Total physical inventory at the location (includes committed units).\n\nShown when filtering by a specific location.' },
    { name: 'Available', description: 'Units available for sale = On Hand - Committed.\n\nShown when filtering by a specific location.' },
    { name: 'Committed', description: 'Units reserved for pending orders.\n\nShown when filtering by a specific location.' },
    { name: 'In Air', description: 'Units in transit via air freight (Air Express or Air Slow transfers).\n\nOnly shown when filtering by a specific location. These are tracked from app transfers, not Shopify.' },
    { name: 'In Sea', description: 'Units in transit via sea freight.\n\nOnly shown when filtering by a specific location. These are tracked from app transfers, not Shopify.' },
    { name: 'In Transit', description: 'Total units in transit (In Air + In Sea) from app transfers.\n\nShown in the main overview when not filtering by location.' },
    { name: 'In Prod', description: 'Pending quantity from open production orders (POs with status "In Production" or "Partial").\n\nCalculated as: Ordered Qty - Received Qty for each PO.' },
    { name: 'Total', description: 'Total inventory = LA Office + DTLA WH + China WH + In Transit.\n\nExcludes ShipBob (3PL managed separately).' },
  ];

  // Column definitions for Planning tab
  const columnDefinitions = [
    { name: 'SKU', description: 'Product SKU identifier' },
    { name: 'LA Stock', description: 'Available inventory at LA Office + DTLA WH minus committed orders.\n\nFormula: (LA Office + DTLA WH) - Committed' },
    { name: 'BR', description: 'Burn Rate: Average daily sales velocity (selectable: 7d, 21d, or 90d)' },
    { name: 'In Air', description: 'Units in transit via air freight (from transfers tagged "air")' },
    { name: 'In Sea', description: 'Units in transit via sea freight (from transfers tagged "sea")' },
    { name: 'China', description: 'Available inventory at China warehouse' },
    { name: 'In Prod', description: 'Pending quantity from production orders (Open POs)' },
    { name: 'Need', description: 'Units needed to air-ship to meet target inventory.\n\nLogic:\n1. First check: Is total inventory below target?\n   Target = Target Days × Selected Burn Rate\n   Total = LA Stock + In Air + In Sea\n\n   If Target > Total:\n     Need = Target - Total (simple shortfall)\n\n2. If total meets target, apply sea gap logic:\n   Calculate Runway Air date (when LA + Air runs out)\n   Check earliest Sea ETA\n\n   If Sea ETA > Runway Air date (gap exists):\n     Need = (Gap Days + 4) × Selected Burn Rate\n\n   If Sea ETA ≤ Runway Air date:\n     Need = 0 (sea arrives before stockout)' },
    { name: 'Ship Type', description: 'Recommended shipping method.\n\nLogic:\n1. Calculate Runway Air date (when LA - Committed + Air runs out)\n2. Only include sea inventory if ETA arrives before Runway Air date\n\nDays of Stock = (LA - Committed + Air + Effective Sea) / BR\n\nWith China inventory:\n• ≤15 days → Express\n• ≤60 days → Slow Air\n• ≤90 days → Sea\n• >90 days → No Action\n\nNo China inventory:\n• <60 days → No CN Inv\n• ≥60 days → No Action\n\nPhase out SKU with no China → Phase Out' },
    { name: 'Prod Status', description: 'Production action recommendation.\n\nBased on CN Runway = (LA - Committed + Air + Sea + China WH) / BR:\n\n• >90 days + active PO → Prod Status\n• >90 days + no PO → No Action\n• ≤90 days + active PO → Push Vendor\n• ≤90 days + no PO → Order More' },
    { name: 'Runway Air', description: 'Days until stockout based on LA + Air only.\n\nFormula: (LA Office + DTLA WH - Committed + In Air) / BR\n\nColor: Red if < 60 days\n\nThis date is used to determine if sea shipments will arrive in time.' },
    { name: 'LA Runway', description: 'Days until stockout based on LA inventory + incoming shipments.\n\nFormula: (LA Office + DTLA WH - Committed + In Air + In Sea) / BR\n\nColor: Red if < 90 days' },
    { name: 'CN Runway', description: 'Days until stockout including China warehouse inventory.\n\nFormula: (LA Office + DTLA WH - Committed + In Air + In Sea + China WH) / BR\n\nThis shows total runway if all China inventory were shipped.' },
  ];

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
              <div className="flex gap-3 flex-wrap items-end">
                {/* Product Filter */}
                <div className="flex flex-col relative">
                  <span className="text-[10px] text-gray-400 mb-1">Product</span>
                  <button
                    onClick={() => setShowInventoryProductDropdown(!showInventoryProductDropdown)}
                    className="h-[34px] px-3 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left flex items-center justify-between min-w-[140px]"
                  >
                    <span className="truncate">
                      {inventoryFilterProducts.length === 0 
                        ? 'All Products' 
                        : inventoryFilterProducts.length === 1 
                          ? inventoryFilterProducts[0]
                          : `${inventoryFilterProducts.length} selected`}
                    </span>
                    <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                {/* View Mode Toggle */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-400 mb-1">View</span>
                  <div className="flex bg-gray-100 p-1 rounded-lg h-[34px] items-center">
                    <button onClick={() => setLocationViewMode('list')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${locationViewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                      List
                    </button>
                    <button onClick={() => setLocationViewMode('grouped')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${locationViewMode === 'grouped' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                      Grouped
                    </button>
                  </div>
                </div>
              </div>
              <div className="relative" ref={locationSearchRef}>
                {(() => {
                  const term = locationSearchTerm.toLowerCase();
                  const suggestions = showLocationSearchSuggestions && locationSearchTerm.length >= 2 && locationData
                    ? locationData
                        .filter(item => 
                          item.sku.toLowerCase().includes(term) ||
                          item.productTitle.toLowerCase().includes(term) ||
                          item.variantTitle.toLowerCase().includes(term)
                        )
                        .slice(0, 8)
                        .map(item => ({
                          sku: item.sku,
                          display: `${item.sku} - ${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`
                        }))
                    : [];
                  
                  return (
                    <>
                      <input 
                        type="text" 
                        placeholder="Search by SKU, product, or variant..." 
                        value={locationSearchTerm} 
                        onChange={(e) => {
                          setLocationSearchTerm(e.target.value);
                          setShowLocationSearchSuggestions(e.target.value.length >= 2);
                          setLocationSearchSuggestionIndex(-1);
                        }}
                        onFocus={() => {
                          if (locationSearchTerm.length >= 2) setShowLocationSearchSuggestions(true);
                        }}
                        onKeyDown={(e) => {
                          if (!showLocationSearchSuggestions || suggestions.length === 0) {
                            if (e.key === 'Enter') setShowLocationSearchSuggestions(false);
                            return;
                          }
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setLocationSearchSuggestionIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setLocationSearchSuggestionIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
                          } else if (e.key === 'Enter') {
                            e.preventDefault();
                            if (locationSearchSuggestionIndex >= 0 && locationSearchSuggestionIndex < suggestions.length) {
                              setLocationSearchTerm(suggestions[locationSearchSuggestionIndex].sku);
                            }
                            setShowLocationSearchSuggestions(false);
                            setLocationSearchSuggestionIndex(-1);
                          } else if (e.key === 'Escape') {
                            setShowLocationSearchSuggestions(false);
                            setLocationSearchSuggestionIndex(-1);
                          }
                        }}
                        className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                      />
                      {suggestions.length > 0 && (
                        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 w-full min-w-[320px] max-h-64 overflow-y-auto">
                          {suggestions.map((s, idx) => (
                            <button
                              key={s.sku}
                              type="button"
                              onClick={() => {
                                setLocationSearchTerm(s.sku);
                                setShowLocationSearchSuggestions(false);
                                setLocationSearchSuggestionIndex(-1);
                              }}
                              className={`w-full px-3 py-2 text-left text-sm border-b border-gray-100 last:border-b-0 ${
                                idx === locationSearchSuggestionIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-blue-50 hover:text-blue-700'
                              }`}
                            >
                              <span className="font-mono font-medium">{s.sku}</span>
                              <span className="text-gray-500 ml-2 text-xs truncate">{s.display.replace(s.sku + ' - ', '')}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
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
                      <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('inboundAir')}>
                        In Air <SortIcon active={locationSortBy === 'inboundAir'} order={locationSortOrder} />
                      </th>
                      <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('inboundSea')}>
                        In Sea <SortIcon active={locationSortBy === 'inboundSea'} order={locationSortOrder} />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {locationData.map((item, index) => {
                      const skuComment = skuComments[item.sku.toUpperCase()];
                      const commentTooltip = skuComment 
                        ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                        : undefined;
                      return (
                      <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="w-32 px-3 sm:px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={commentTooltip}>
                          {item.sku}
                          {skuComment && <span className="ml-1">💬</span>}
                        </td>
                        <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.onHand.toLocaleString()}</td>
                        <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${item.available <= 0 ? 'text-red-600 font-medium' : item.available <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>{item.available.toLocaleString()}</td>
                        <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center text-gray-900">{item.committed.toLocaleString()}</td>
                        <td 
                          className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.inboundAir > 0 ? 'text-purple-600 font-medium cursor-help' : 'text-gray-400'}`}
                          title={formatTransferTooltip(item.airTransfers)}
                        >
                          {item.inboundAir > 0 ? item.inboundAir.toLocaleString() : '—'}
                        </td>
                        <td 
                          className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${item.inboundSea > 0 ? 'text-blue-600 font-medium cursor-help' : 'text-gray-400'}`}
                          title={formatTransferTooltip(item.seaTransfers)}
                        >
                          {item.inboundSea > 0 ? item.inboundSea.toLocaleString() : '—'}
                        </td>
                      </tr>
                    );})}
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
                // Sort items within group using helper function
                const items = sortSkusInGroup(groupedLocationDetail[groupName], groupName);
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
                          {items.map((item, index) => {
                            const skuComment = skuComments[item.sku.toUpperCase()];
                            const commentTooltip = skuComment 
                              ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                              : undefined;
                            return (
                            <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="w-32 px-3 sm:px-4 py-2 text-sm font-medium text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis" title={commentTooltip}>
                                {item.sku}
                                {skuComment && <span className="ml-1">💬</span>}
                              </td>
                              <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{item.onHand.toLocaleString()}</td>
                              <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.available <= 0 ? 'text-red-600 font-medium' : item.available <= 10 ? 'text-orange-600' : 'text-gray-900'}`}>{item.available.toLocaleString()}</td>
                              <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center text-gray-900">{item.committed.toLocaleString()}</td>
                              <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${item.incoming > 0 ? 'text-purple-600 font-medium' : 'text-gray-900'}`}>{item.incoming.toLocaleString()}</td>
                            </tr>
                          );})}
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
    <>
      {/* Global Status Overlay */}
      {globalStatus && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full mx-4 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
            <p className="text-lg font-semibold text-gray-900">{globalStatus.message}</p>
            {globalStatus.subMessage && (
              <p className="text-sm text-gray-500 mt-2">{globalStatus.subMessage}</p>
            )}
          </div>
        </div>
      )}
      
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
                  })}{inventoryData.refreshedBy && ` by ${inventoryData.refreshedBy}`}
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

          {/* Tabs and Refresh */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-max sm:w-fit">
                <button
                  onClick={() => setActiveTab('inventory')}
                  className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'inventory' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
                  }`}
                >
                  📊 Overview
                </button>
                <button
                  onClick={() => setActiveTab('planning')}
                  className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'planning' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
                  }`}
                >
                  📋 Planning
                </button>
                <button
                  onClick={() => setActiveTab('production')}
                  className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'production' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
                  }`}
                >
                  🚚 POs & Transfers
                </button>
                <button
                  onClick={() => setActiveTab('warehouse')}
                  className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'warehouse' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
                  }`}
                >
                  📦 Inventory Counts
                </button>
                <button
                  onClick={() => setActiveTab('forecasting')}
                  className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'forecasting' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-white'
                  }`}
                >
                  📈 Forecast
                </button>
              </div>
            </div>
            <div className="hidden md:flex flex-col items-end shrink-0">
              <button 
                onClick={() => refreshAllData()} 
                disabled={isRefreshing}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
              >
                {isRefreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
              </button>
              <p className="text-xs text-red-500 mt-1">Data auto-refreshes every hour</p>
            </div>
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
                <button onClick={() => refreshAllData()} disabled={isRefreshing}
                  className={`px-4 py-2 text-sm font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                  {isRefreshing ? '⏳ Loading data from Shopify...' : '🔄 Refresh Data'}
                </button>
              </div>
            )}

            {!inventoryLoading && inventoryData && (
              <div className="space-y-6">
                {/* Location Tiles - Fixed order */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  {(['LA Office', 'DTLA WH', 'China WH', 'ShipBob'] as const).filter(loc => inventoryData.locations.includes(loc)).map((location, idx) => {
                    const locationTotal = inventoryData.inventory.reduce((sum, item) => sum + (item.locations[location] || 0), 0);
                    const colors = ['blue', 'green', 'purple', 'orange'];
                    const color = colors[idx % colors.length];
                    const isSelected = inventoryLocationFilters.includes(location);
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
                        onClick={() => setInventoryLocationFilters(prev => 
                          isSelected 
                            ? prev.filter(l => l !== location)
                            : [...prev, location]
                        )}
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
                    <div className="flex gap-3 flex-wrap items-end">
                      {/* Product Filter */}
                      <div className="flex flex-col relative" ref={inventoryProductDropdownRef}>
                        <span className="text-[10px] text-gray-400 mb-1">Product</span>
                        <button
                          onClick={() => setShowInventoryProductDropdown(!showInventoryProductDropdown)}
                          className="h-[34px] px-3 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left flex items-center justify-between min-w-[140px]"
                        >
                          <span className="truncate">
                            {inventoryFilterProducts.length === 0 
                              ? 'All Products' 
                              : inventoryFilterProducts.length === 1 
                                ? inventoryFilterProducts[0]
                                : `${inventoryFilterProducts.length} selected`}
                          </span>
                          <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {showInventoryProductDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 min-w-[200px] max-h-[300px] overflow-y-auto">
                            <div className="p-2 border-b border-gray-200">
                              <button
                                onClick={() => setInventoryFilterProducts([])}
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                Clear all
                              </button>
                            </div>
                            {allInventoryProductGroups.map(group => (
                              <label
                                key={group}
                                className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={inventoryFilterProducts.includes(group)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setInventoryFilterProducts([...inventoryFilterProducts, group]);
                                    } else {
                                      setInventoryFilterProducts(inventoryFilterProducts.filter(p => p !== group));
                                    }
                                  }}
                                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                                <span className="ml-2 text-xs text-gray-700">{group}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* View Mode Toggle */}
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 mb-1">View</span>
                        <div className="flex bg-gray-100 p-1 rounded-lg h-[34px] items-center">
                          <button
                            onClick={() => setInventoryViewMode('list')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                              inventoryViewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            List
                          </button>
                          <button
                            onClick={() => setInventoryViewMode('grouped')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                              inventoryViewMode === 'grouped' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            Grouped
                          </button>
                        </div>
                      </div>
                      {/* Comment Button */}
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 mb-1">Notes</span>
                        <button
                          onClick={() => setShowSkuCommentForm(true)}
                          className="h-[34px] px-3 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                        >
                          💬 Comment
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowOverviewColumnDefinitions(true)}
                        className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
                      >
                        Column Info
                      </button>
                      <div className="relative" ref={searchRef}>
                        {(() => {
                          const term = searchTerm.toLowerCase();
                          const suggestions = showSearchSuggestions && searchTerm.length >= 2 && inventoryData?.inventory
                            ? inventoryData.inventory
                                .filter(item => 
                                  item.sku.toLowerCase().includes(term) ||
                                  item.productTitle.toLowerCase().includes(term) ||
                                  item.variantTitle.toLowerCase().includes(term)
                                )
                                .slice(0, 8)
                                .map(item => ({
                                  sku: item.sku,
                                  display: `${item.sku} - ${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`
                                }))
                            : [];
                          
                          return (
                            <>
                              <input 
                                type="text" 
                                placeholder="Search by SKU, product, or variant..." 
                                value={searchTerm} 
                                onChange={(e) => {
                                  setSearchTerm(e.target.value);
                                  setShowSearchSuggestions(e.target.value.length >= 2);
                                  setSearchSuggestionIndex(-1);
                                }}
                                onFocus={() => {
                                  if (searchTerm.length >= 2) setShowSearchSuggestions(true);
                                }}
                                onKeyDown={(e) => {
                                  if (!showSearchSuggestions || suggestions.length === 0) {
                                    if (e.key === 'Enter') setShowSearchSuggestions(false);
                                    return;
                                  }
                                  if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setSearchSuggestionIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
                                  } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setSearchSuggestionIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
                                  } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (searchSuggestionIndex >= 0 && searchSuggestionIndex < suggestions.length) {
                                      setSearchTerm(suggestions[searchSuggestionIndex].sku);
                                    }
                                    setShowSearchSuggestions(false);
                                    setSearchSuggestionIndex(-1);
                                  } else if (e.key === 'Escape') {
                                    setShowSearchSuggestions(false);
                                    setSearchSuggestionIndex(-1);
                                  }
                                }}
                                className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                              />
                              {suggestions.length > 0 && (
                                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 w-full min-w-[320px] max-h-64 overflow-y-auto">
                                  {suggestions.map((s, idx) => (
                                    <button
                                      key={s.sku}
                                      type="button"
                                      onClick={() => {
                                        setSearchTerm(s.sku);
                                        setShowSearchSuggestions(false);
                                        setSearchSuggestionIndex(-1);
                                      }}
                                      className={`w-full px-3 py-2 text-left text-sm border-b border-gray-100 last:border-b-0 ${
                                        idx === searchSuggestionIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-blue-50 hover:text-blue-700'
                                      }`}
                                    >
                                      <span className="font-mono font-medium">{s.sku}</span>
                                      <span className="text-gray-500 ml-2 text-xs truncate">{s.display.replace(s.sku + ' - ', '')}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Overview Column Definitions Modal */}
                {showOverviewColumnDefinitions && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
                      <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Overview Column Definitions</h3>
                        <button
                          onClick={() => setShowOverviewColumnDefinitions(false)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="overflow-y-auto max-h-[calc(80vh-80px)]">
                        <table className="min-w-full">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase w-28">Column</th>
                              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {overviewColumnDefinitions.map((col, index) => (
                              <tr key={col.name} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="px-6 py-3 text-sm font-medium text-gray-900 align-top">{col.name}</td>
                                <td className="px-6 py-3 text-sm text-gray-600 whitespace-pre-line">{col.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

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
                            {showLocationDetailView ? (
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
                                <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('inboundAir')}>
                                  In Air <SortIcon active={locationSortBy === 'inboundAir'} order={locationSortOrder} />
                                </th>
                                <th className="w-20 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleLocationSort('inboundSea')}>
                                  In Sea <SortIcon active={locationSortBy === 'inboundSea'} order={locationSortOrder} />
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
                                <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('inTransit')}>
                                  In Transit <SortIcon active={sortBy === 'inTransit'} order={sortOrder} />
                                </th>
                                <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                                  In Prod
                                </th>
                                <th className="w-24 px-3 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('total')}>
                                  Total <SortIcon active={sortBy === 'total'} order={sortOrder} />
                                </th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {showLocationDetailView ? (
                            // Location Detail View (single or aggregated)
                            filteredLocationDetail.map((item, index) => {
                              const skuComment = skuComments[item.sku.toUpperCase()];
                              const commentTooltip = skuComment 
                                ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                                : undefined;
                              // Check if SKU is in phase out list or discontinued list
                              const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
                              const isDiscontinued = DISCONTINUED_SKUS.some(s => s.toLowerCase() === item.sku.toLowerCase());
                              const isGrayedOut = isPhaseOut || isDiscontinued;
                              return (
                              <tr key={item.sku} className={isGrayedOut ? 'bg-gray-100' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                                <td className={`w-32 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}
                                  title={commentTooltip}>
                                  {item.sku}
                                  {skuComment && <span className="ml-1">💬</span>}
                                </td>
                                <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.onHand <= 0 ? 'text-red-600 font-medium' : item.onHand <= 10 ? 'text-orange-600' : 'text-gray-900')}`}>
                                  {item.onHand.toLocaleString()}
                                </td>
                                <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.available <= 0 ? 'text-red-600 font-medium' : item.available <= 10 ? 'text-orange-600' : 'text-gray-900')}`}>
                                  {item.available.toLocaleString()}
                                </td>
                                <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.committed > 0 ? 'text-purple-600' : 'text-gray-400')}`}>
                                  {item.committed.toLocaleString()}
                                </td>
                                <td 
                                  className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.inboundAir > 0 ? 'text-purple-600 font-medium cursor-help' : 'text-gray-400')}`}
                                  title={formatTransferTooltip(item.airTransfers)}
                                >
                                  {item.inboundAir > 0 ? item.inboundAir.toLocaleString() : '—'}
                                </td>
                                <td 
                                  className={`w-20 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.inboundSea > 0 ? 'text-blue-600 font-medium cursor-help' : 'text-gray-400')}`}
                                  title={formatTransferTooltip(item.seaTransfers)}
                                >
                                  {item.inboundSea > 0 ? item.inboundSea.toLocaleString() : '—'}
                                </td>
                              </tr>
                            );})
                          ) : (
                            // All Locations View
                            filteredInventory.map((item, index) => {
                              // Calculate total in transit from our local transfers (In Air + In Sea across all destinations)
                              let inTransit = 0;
                              const allTransferDetails: TransferDetail[] = [];
                              for (const [, skuData] of Object.entries(incomingFromTransfersData)) {
                                const skuIncoming = skuData[item.sku];
                                if (skuIncoming) {
                                  inTransit += skuIncoming.inboundAir + skuIncoming.inboundSea;
                                  allTransferDetails.push(...skuIncoming.airTransfers, ...skuIncoming.seaTransfers);
                                }
                              }
                              const transferTooltip = formatTransferTooltip(allTransferDetails);
                              // Get pending PO quantity for this SKU
                              const poQty = purchaseOrderData?.purchaseOrders?.find(p => p.sku === item.sku)?.pendingQuantity || 0;
                              // Check if SKU is in phase out list or discontinued list
                              const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
                              const isDiscontinued = DISCONTINUED_SKUS.some(s => s.toLowerCase() === item.sku.toLowerCase());
                              const isGrayedOut = isPhaseOut || isDiscontinued;
                              
                              const skuComment = skuComments[item.sku.toUpperCase()];
                              const commentTooltip = skuComment 
                                ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                                : undefined;
                              
                              return (
                                <tr key={item.sku} className={isGrayedOut ? 'bg-gray-100' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                                  <td className={`w-32 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}
                                    title={commentTooltip}>
                                    {item.sku}
                                    {skuComment && <span className="ml-1">💬</span>}
                                  </td>
                                  {inventoryData.locations.map(location => {
                                    const qty = item.locations?.[location] ?? 0;
                                    return (
                                      <td key={location} className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (qty <= 0 ? 'text-red-600 font-medium' : qty <= 10 ? 'text-orange-600' : 'text-gray-900')}`}>
                                        {qty.toLocaleString()}
                                      </td>
                                    );
                                  })}
                                  <td 
                                    className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (inTransit > 0 ? 'text-blue-600 font-medium cursor-help' : 'text-gray-400')}`}
                                    title={transferTooltip}
                                  >
                                    {inTransit > 0 ? inTransit.toLocaleString() : '—'}
                                  </td>
                                  <td className="w-24 px-3 sm:px-4 py-3 text-sm text-center">
                                    {isPhaseOut ? (
                                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-500 whitespace-nowrap">Phase Out</span>
                                    ) : (
                                      <span className={isGrayedOut ? 'text-gray-500' : (poQty > 0 ? 'text-blue-600 font-medium' : 'text-gray-400')}>
                                        {poQty > 0 ? poQty.toLocaleString() : '—'}
                                      </span>
                                    )}
                                  </td>
                                  {(() => {
                                    const total = calculateOverviewTotal(item, inTransit);
                                    return (
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center font-medium ${isGrayedOut ? 'text-gray-500' : (total <= 0 ? 'text-red-600' : total <= 10 ? 'text-orange-600' : 'text-gray-900')}`}>
                                        {total.toLocaleString()}
                                      </td>
                                    );
                                  })()}
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    {((showLocationDetailView && filteredLocationDetail.length === 0) || (!showLocationDetailView && filteredInventory.length === 0)) && 
                      <div className="p-8 text-center text-gray-500">No inventory items match your filters.</div>}
                  </div>
                )}

                {/* Grouped View */}
                {inventoryViewMode === 'grouped' && (
                  <div className="space-y-4">
                    {showLocationDetailView ? (
                      // Location Detail Grouped View (single or aggregated)
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
                          const items = sortSkusInGroup(groupedLocationItems[groupName], groupName);
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
                                      <th className="w-20 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">In Air</th>
                                      <th className="w-20 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">In Sea</th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {items.map((item, index) => {
                                      const skuComment = skuComments[item.sku.toUpperCase()];
                                      const commentTooltip = skuComment 
                                        ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                                        : undefined;
                                      // Check if SKU is in phase out list or discontinued list
                                      const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
                                      const isDiscontinued = DISCONTINUED_SKUS.some(s => s.toLowerCase() === item.sku.toLowerCase());
                                      const isGrayedOut = isPhaseOut || isDiscontinued;
                                      return (
                                      <tr key={item.sku} className={isGrayedOut ? 'bg-gray-100' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                                        <td className={`w-32 px-3 sm:px-4 py-2 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}
                                          title={commentTooltip}>
                                          {item.sku}
                                          {skuComment && <span className="ml-1">💬</span>}
                                        </td>
                                        <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.onHand <= 0 ? 'text-red-600 font-medium' : item.onHand <= 10 ? 'text-orange-600' : 'text-gray-900')}`}>
                                          {item.onHand.toLocaleString()}
                                        </td>
                                        <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.available <= 0 ? 'text-red-600 font-medium' : item.available <= 10 ? 'text-orange-600' : 'text-gray-900')}`}>
                                          {item.available.toLocaleString()}
                                        </td>
                                        <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.committed > 0 ? 'text-purple-600' : 'text-gray-400')}`}>
                                          {item.committed.toLocaleString()}
                                        </td>
                                        <td 
                                          className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.inboundAir > 0 ? 'text-purple-600 font-medium cursor-help' : 'text-gray-400')}`}
                                          title={formatTransferTooltip(item.airTransfers)}
                                        >
                                          {item.inboundAir > 0 ? item.inboundAir.toLocaleString() : '—'}
                                        </td>
                                        <td 
                                          className={`w-20 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.inboundSea > 0 ? 'text-blue-600 font-medium cursor-help' : 'text-gray-400')}`}
                                          title={formatTransferTooltip(item.seaTransfers)}
                                        >
                                          {item.inboundSea > 0 ? item.inboundSea.toLocaleString() : '—'}
                                        </td>
                                      </tr>
                                    );})}
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
                          const items = sortSkusInGroup(groupedInventory[groupName], groupName);
                          // Calculate group total using the new formula (LA + DTLA + China + In Transit, exclude ShipBob)
                          const groupTotal = items.reduce((sum, item) => {
                            let inTransit = 0;
                            for (const [, skuData] of Object.entries(incomingFromTransfersData)) {
                              const skuIncoming = skuData[item.sku];
                              if (skuIncoming) {
                                inTransit += skuIncoming.inboundAir + skuIncoming.inboundSea;
                              }
                            }
                            return sum + calculateOverviewTotal(item, inTransit);
                          }, 0);
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
                                      <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('inTransit')}>
                                        In Transit <SortIcon active={sortBy === 'inTransit'} order={sortOrder} />
                                      </th>
                                      <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                        In Prod
                                      </th>
                                      <th className="w-24 px-3 sm:px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('total')}>
                                        Total <SortIcon active={sortBy === 'total'} order={sortOrder} />
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {items.map((item, index) => {
                                      // Calculate total in transit from our local transfers (In Air + In Sea across all destinations)
                                      let inTransit = 0;
                                      const allTransferDetails: TransferDetail[] = [];
                                      for (const [, skuData] of Object.entries(incomingFromTransfersData)) {
                                        const skuIncoming = skuData[item.sku];
                                        if (skuIncoming) {
                                          inTransit += skuIncoming.inboundAir + skuIncoming.inboundSea;
                                          allTransferDetails.push(...skuIncoming.airTransfers, ...skuIncoming.seaTransfers);
                                        }
                                      }
                                      const transferTooltip = formatTransferTooltip(allTransferDetails);
                                      // Get pending PO quantity for this SKU
                                      const poQty = purchaseOrderData?.purchaseOrders?.find(p => p.sku === item.sku)?.pendingQuantity || 0;
                                      // Check if SKU is in phase out list or discontinued list
                                      const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
                                      const isDiscontinued = DISCONTINUED_SKUS.some(s => s.toLowerCase() === item.sku.toLowerCase());
                                      const isGrayedOut = isPhaseOut || isDiscontinued;
                                      
                                      const skuComment = skuComments[item.sku.toUpperCase()];
                                      const commentTooltip = skuComment 
                                        ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                                        : undefined;
                                      
                                      return (
                                        <tr key={item.sku} className={isGrayedOut ? 'bg-gray-100' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                                          <td className={`w-32 px-3 sm:px-4 py-2 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}
                                            title={commentTooltip}>
                                            {item.sku}
                                            {skuComment && <span className="ml-1">💬</span>}
                                          </td>
                                          {inventoryData.locations.map(location => {
                                            const qty = item.locations?.[location] ?? 0;
                                            return (
                                              <td key={location} className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (qty <= 0 ? 'text-red-600 font-medium' : qty <= 10 ? 'text-orange-600' : 'text-gray-900')}`}>
                                                {qty.toLocaleString()}
                                              </td>
                                            );
                                          })}
                                          <td 
                                            className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (inTransit > 0 ? 'text-blue-600 font-medium cursor-help' : 'text-gray-400')}`}
                                            title={transferTooltip}
                                          >
                                            {inTransit > 0 ? inTransit.toLocaleString() : '—'}
                                          </td>
                                          <td className="w-24 px-3 sm:px-4 py-2 text-sm text-center">
                                            {isPhaseOut ? (
                                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-500 whitespace-nowrap">Phase Out</span>
                                            ) : (
                                              <span className={isGrayedOut ? 'text-gray-500' : (poQty > 0 ? 'text-blue-600 font-medium' : 'text-gray-400')}>
                                                {poQty > 0 ? poQty.toLocaleString() : '—'}
                                              </span>
                                            )}
                                          </td>
                                          {(() => {
                                            const total = calculateOverviewTotal(item, inTransit);
                                            return (
                                              <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center font-medium ${isGrayedOut ? 'text-gray-500' : (total <= 0 ? 'text-red-600' : total <= 10 ? 'text-orange-600' : 'text-gray-900')}`}>
                                                {total.toLocaleString()}
                                              </td>
                                            );
                                          })()}
                                        </tr>
                                      );
                                    })}
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
                
                {/* Export Button */}
                <div className="mt-6 flex flex-col items-end gap-2">
                  <button
                    onClick={() => {
                      // Build CSV content for Inventory
                      let headers: string[];
                      let rows: (string | number)[][];
                      
                      if (showLocationDetailView) {
                        // Location detail view - single or aggregated locations
                        headers = ['SKU', 'Product', 'On Hand', 'Available', 'Committed', 'In Air', 'In Sea'];
                        rows = filteredLocationDetail.map(item => [
                          item.sku,
                          `"${item.productTitle.replace(/"/g, '""')}"`,
                          item.onHand,
                          item.available,
                          item.committed,
                          item.inboundAir || 0,
                          item.inboundSea || 0
                        ]);
                      } else {
                        // All locations view
                        headers = ['SKU', 'Product', ...inventoryData.locations, 'In Transit', 'In Prod', 'Total'];
                        rows = filteredInventory.map(item => {
                          // Calculate in transit from cache
                          let inTransit = 0;
                          for (const [, skuData] of Object.entries(incomingFromTransfersData)) {
                            const skuIncoming = skuData[item.sku];
                            if (skuIncoming) {
                              inTransit += skuIncoming.inboundAir + skuIncoming.inboundSea;
                            }
                          }
                          const poQty = purchaseOrderData?.purchaseOrders?.find(p => p.sku === item.sku)?.pendingQuantity || 0;
                          const locationQtys = inventoryData.locations.map(loc => item.locations?.[loc] ?? 0);
                          const total = calculateOverviewTotal(item, inTransit);
                          return [
                            item.sku,
                            `"${item.productTitle.replace(/"/g, '""')}"`,
                            ...locationQtys,
                            inTransit,
                            poQty,
                            total
                          ];
                        });
                      }
                      
                      const csvContent = [
                        headers.join(','),
                        ...rows.map(row => row.join(','))
                      ].join('\n');
                      
                      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                      const link = document.createElement('a');
                      const url = URL.createObjectURL(blob);
                      link.setAttribute('href', url);
                      const now = new Date();
                      const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours() % 12 || 12).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${now.getHours() >= 12 ? 'PM' : 'AM'}`;
                      const locationSuffix = inventoryLocationFilters.length > 0 
                        ? `-${inventoryLocationFilters.join('-').replace(/\s+/g, '-')}` 
                        : activeLocationFilter 
                          ? `-${activeLocationFilter.replace(/\s+/g, '-')}` 
                          : '';
                      link.setAttribute('download', `inventory-export-${timestamp}${locationSuffix}.csv`);
                      link.style.visibility = 'hidden';
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="px-6 py-3 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                  >
                    <span>📥</span> Export to Excel
                  </button>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setShowMcEditForm(true)}
                      className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                    >
                      Manage Qty per MC
                    </button>
                    <button
                      onClick={() => setShowPhaseOutModal(true)}
                      className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                    >
                      Manage Phase Outs
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* MC Edit Form Modal */}
        {showMcEditForm && inventoryData && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Quantity per Master Carton</h3>
                <p className="text-sm text-gray-500 mt-1">Set units per MC for automatic calculation</p>
              </div>
              <div className="px-6 py-4 flex-1 overflow-y-auto">
                {/* Search box */}
                <div className="mb-4">
                  <input
                    type="text"
                    placeholder="Search SKU..."
                    value={mcSearchTerm}
                    onChange={(e) => setMcSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                
                {/* SKU list */}
                <div className="space-y-2">
                  {inventoryData.inventory
                    .map(item => item.sku)
                    .sort()
                    .filter((sku) => {
                      if (mcSearchTerm.length < 2) return true;
                      return sku.toUpperCase().includes(mcSearchTerm.toUpperCase());
                    })
                    .map((sku) => {
                      const currentValue = mcData[sku.toUpperCase()] || '';
                      return (
                        <div key={sku} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-md gap-3">
                          <span className="text-sm font-medium text-gray-900 font-mono">{sku}</span>
                          <input
                            type="number"
                            value={currentValue}
                            onChange={(e) => {
                              const updatedMcData = { ...mcData };
                              const val = e.target.value;
                              if (val === '' || parseInt(val) <= 0) {
                                delete updatedMcData[sku.toUpperCase()];
                              } else {
                                updatedMcData[sku.toUpperCase()] = parseInt(val);
                              }
                              setMcData(updatedMcData);
                            }}
                            className="w-20 px-2 py-1 border border-gray-300 rounded-md text-sm text-right focus:ring-blue-500 focus:border-blue-500"
                            placeholder="—"
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowMcEditForm(false);
                    setMcSearchTerm('');
                    loadMcData(); // Reload to discard changes
                  }}
                  disabled={isSavingMcData}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => saveMcData(mcData)}
                  disabled={isSavingMcData}
                  className={`flex-1 px-4 py-2 rounded-md text-sm font-medium ${
                    isSavingMcData
                      ? 'bg-blue-400 text-white cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isSavingMcData ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
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
                <button onClick={() => refreshAllData()} disabled={isRefreshing}
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
                    <div className="relative" ref={forecastSearchRef}>
                      {(() => {
                        const term = forecastSearchTerm.toLowerCase();
                        const suggestions = showForecastSearchSuggestions && forecastSearchTerm.length >= 2 && inventoryData?.inventory
                          ? inventoryData.inventory
                              .filter(item => 
                                item.sku.toLowerCase().includes(term) ||
                                item.productTitle.toLowerCase().includes(term) ||
                                item.variantTitle.toLowerCase().includes(term)
                              )
                              .slice(0, 8)
                              .map(item => ({
                                sku: item.sku,
                                display: `${item.sku} - ${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`
                              }))
                          : [];
                        
                        return (
                          <>
                            <input 
                              type="text" 
                              placeholder="Search by SKU, product, or variant..." 
                              value={forecastSearchTerm} 
                              onChange={(e) => {
                                setForecastSearchTerm(e.target.value);
                                setShowForecastSearchSuggestions(e.target.value.length >= 2);
                                setForecastSearchSuggestionIndex(-1);
                              }}
                              onFocus={() => {
                                if (forecastSearchTerm.length >= 2) setShowForecastSearchSuggestions(true);
                              }}
                              onKeyDown={(e) => {
                                if (!showForecastSearchSuggestions || suggestions.length === 0) {
                                  if (e.key === 'Enter') setShowForecastSearchSuggestions(false);
                                  return;
                                }
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setForecastSearchSuggestionIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setForecastSearchSuggestionIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
                                } else if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (forecastSearchSuggestionIndex >= 0 && forecastSearchSuggestionIndex < suggestions.length) {
                                    setForecastSearchTerm(suggestions[forecastSearchSuggestionIndex].sku);
                                  }
                                  setShowForecastSearchSuggestions(false);
                                  setForecastSearchSuggestionIndex(-1);
                                } else if (e.key === 'Escape') {
                                  setShowForecastSearchSuggestions(false);
                                  setForecastSearchSuggestionIndex(-1);
                                }
                              }}
                              className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                            />
                            {suggestions.length > 0 && (
                              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 w-full min-w-[320px] max-h-64 overflow-y-auto">
                                {suggestions.map((s, idx) => (
                                  <button
                                    key={s.sku}
                                    type="button"
                                    onClick={() => {
                                      setForecastSearchTerm(s.sku);
                                      setShowForecastSearchSuggestions(false);
                                      setForecastSearchSuggestionIndex(-1);
                                    }}
                                    className={`w-full px-3 py-2 text-left text-sm border-b border-gray-100 last:border-b-0 ${
                                      idx === forecastSearchSuggestionIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-blue-50 hover:text-blue-700'
                                    }`}
                                  >
                                    <span className="font-mono font-medium">{s.sku}</span>
                                    <span className="text-gray-500 ml-2 text-xs truncate">{s.display.replace(s.sku + ' - ', '')}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
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
                            
                            const skuComment = skuComments[item.sku.toUpperCase()];
                            const commentTooltip = skuComment 
                              ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                              : undefined;
                            
                            // Check if SKU is discontinued or phase out
                            const isDiscontinued = DISCONTINUED_SKUS.some(s => s.toLowerCase() === item.sku.toLowerCase());
                            const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
                            const isGrayedOut = isDiscontinued || isPhaseOut;
                            
                            return (
                              <tr key={item.sku} className={isGrayedOut ? 'bg-gray-100' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                                <td className={`w-32 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`} title={commentTooltip}>
                                  {item.sku}
                                  {skuComment && <span className="ml-1">💬</span>}
                                </td>
                                <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (inventory <= 0 ? 'text-red-600 font-medium' : 'text-gray-900')}`}>{inventory.toLocaleString()}</td>
                                {forecastLayout === 'byPeriod' ? (
                                  forecastViewMode === 'velocity' ? (
                                    <>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{item.avgDaily7d.toFixed(1)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{item.avgDaily21d.toFixed(1)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{item.avgDaily90d.toFixed(1)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-500'}`}>{item.avgDailyLastYear30d.toFixed(1)}</td>
                                    </>
                                  ) : forecastViewMode === 'daysLeft' ? (
                                    <>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days7d)}`}>{formatDaysOfStock(days7d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days21d)}`}>{formatDaysOfStock(days21d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days90d)}`}>{formatDaysOfStock(days90d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(daysLY30d)}`}>{formatDaysOfStock(daysLY30d)}</td>
                                    </>
                                  ) : (
                                    <>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days7d)}`}>{formatRunOutDate(days7d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days21d)}`}>{formatRunOutDate(days21d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days90d)}`}>{formatRunOutDate(days90d)}</td>
                                      <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(daysLY30d)}`}>{formatRunOutDate(daysLY30d)}</td>
                                    </>
                                  )
                                ) : (
                                  <>
                                    <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{selectedData.avgDaily.toFixed(1)}</td>
                                    <td className={`w-24 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(selectedData.days)}`}>{formatDaysOfStock(selectedData.days)}</td>
                                    <td className={`w-28 px-3 sm:px-4 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(selectedData.days)}`}>{formatRunOutDate(selectedData.days)}</td>
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
                      // Sort items within group using helper function
                      const items = sortSkusInGroup(groupedForecasting[groupName], groupName);
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
                                  
                                  const skuComment = skuComments[item.sku.toUpperCase()];
                                  const commentTooltip = skuComment 
                                    ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                                    : undefined;
                                  
                                  // Check if SKU is discontinued or phase out
                                  const isDiscontinued = DISCONTINUED_SKUS.some(s => s.toLowerCase() === item.sku.toLowerCase());
                                  const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
                                  const isGrayedOut = isDiscontinued || isPhaseOut;
                                  
                                  return (
                                    <tr key={item.sku} className={isGrayedOut ? 'bg-gray-100' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                                      <td className={`w-32 px-3 sm:px-4 py-2 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`} title={commentTooltip}>
                                        {item.sku}
                                        {skuComment && <span className="ml-1">💬</span>}
                                      </td>
                                      <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (inventory <= 0 ? 'text-red-600 font-medium' : 'text-gray-900')}`}>{inventory.toLocaleString()}</td>
                                      {forecastLayout === 'byPeriod' ? (
                                        forecastViewMode === 'velocity' ? (
                                          <>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{item.avgDaily7d.toFixed(1)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{item.avgDaily21d.toFixed(1)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{item.avgDaily90d.toFixed(1)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-500'}`}>{item.avgDailyLastYear30d.toFixed(1)}</td>
                                          </>
                                        ) : forecastViewMode === 'daysLeft' ? (
                                          <>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days7d)}`}>{formatDaysOfStock(days7d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days21d)}`}>{formatDaysOfStock(days21d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days90d)}`}>{formatDaysOfStock(days90d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(daysLY30d)}`}>{formatDaysOfStock(daysLY30d)}</td>
                                          </>
                                        ) : (
                                          <>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days7d)}`}>{formatRunOutDate(days7d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days21d)}`}>{formatRunOutDate(days21d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(days90d)}`}>{formatRunOutDate(days90d)}</td>
                                            <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(daysLY30d)}`}>{formatRunOutDate(daysLY30d)}</td>
                                          </>
                                        )
                                      ) : (
                                        <>
                                          <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{selectedData.avgDaily.toFixed(1)}</td>
                                          <td className={`w-24 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(selectedData.days)}`}>{formatDaysOfStock(selectedData.days)}</td>
                                          <td className={`w-28 px-3 sm:px-4 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : getDaysColor(selectedData.days)}`}>{formatRunOutDate(selectedData.days)}</td>
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
                
                {/* Export Button */}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => {
                      // Build CSV content for Forecasting
                      const headers = ['SKU', 'Product', 'Inventory', 'Avg Daily (7d)', 'Days (7d)', 'Avg Daily (21d)', 'Days (21d)', 'Avg Daily (90d)', 'Days (90d)', 'Avg Daily (LY 30d)', 'Days (LY 30d)'];
                      const rows = filteredForecasting.map(item => {
                        const inventory = item.totalInventory || 0;
                        const days7d = item.avgDaily7d > 0 ? Math.round(inventory / item.avgDaily7d) : 999;
                        const days21d = item.avgDaily21d > 0 ? Math.round(inventory / item.avgDaily21d) : 999;
                        const days90d = item.avgDaily90d > 0 ? Math.round(inventory / item.avgDaily90d) : 999;
                        const daysLY30d = item.avgDailyLastYear30d > 0 ? Math.round(inventory / item.avgDailyLastYear30d) : 999;
                        return [
                          item.sku,
                          `"${item.productName.replace(/"/g, '""')}"`,
                          inventory,
                          item.avgDaily7d.toFixed(1),
                          days7d >= 999 ? 'N/A' : days7d,
                          item.avgDaily21d.toFixed(1),
                          days21d >= 999 ? 'N/A' : days21d,
                          item.avgDaily90d.toFixed(1),
                          days90d >= 999 ? 'N/A' : days90d,
                          item.avgDailyLastYear30d.toFixed(1),
                          daysLY30d >= 999 ? 'N/A' : daysLY30d
                        ];
                      });
                      
                      const csvContent = [
                        headers.join(','),
                        ...rows.map(row => row.join(','))
                      ].join('\n');
                      
                      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                      const link = document.createElement('a');
                      const url = URL.createObjectURL(blob);
                      link.setAttribute('href', url);
                      const now = new Date();
                      const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours() % 12 || 12).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${now.getHours() >= 12 ? 'PM' : 'AM'}`;
                      link.setAttribute('download', `forecasting-export-${timestamp}.csv`);
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
                <button onClick={() => refreshAllData()} disabled={isRefreshing}
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
                  
                  // Calculate incoming from our local transfers (not Shopify)
                  const incomingFromTransfers = getIncomingFromTransfers();
                  
                  // Get inbound air to LA area (LA Office + DTLA WH)
                  const getLAInboundAir = (sku: string): number => {
                    const laOffice = incomingFromTransfers['LA Office']?.[sku]?.inboundAir || 0;
                    const dtlaWH = incomingFromTransfers['DTLA WH']?.[sku]?.inboundAir || 0;
                    return laOffice + dtlaWH;
                  };
                  
                  // Get inbound sea to LA area (LA Office + DTLA WH)
                  const getLAInboundSea = (sku: string): number => {
                    const laOffice = incomingFromTransfers['LA Office']?.[sku]?.inboundSea || 0;
                    const dtlaWH = incomingFromTransfers['DTLA WH']?.[sku]?.inboundSea || 0;
                    return laOffice + dtlaWH;
                  };
                  
                  // Get total incoming to LA area (air + sea)
                  const getLAIncoming = (sku: string): number => {
                    return getLAInboundAir(sku) + getLAInboundSea(sku);
                  };
                  
                  // Get transfer notes for LA area (LA Office + DTLA WH)
                  const getLATransferNotes = (sku: string): Array<{ id: string; note: string | null }> => {
                    const laData = incomingFromTransfers['LA Office']?.[sku];
                    const dtlaData = incomingFromTransfers['DTLA WH']?.[sku];
                    const notes: Array<{ id: string; note: string | null }> = [];
                    if (laData) {
                      notes.push(...[...laData.airTransfers, ...laData.seaTransfers].map(t => ({ id: t.id, note: t.note })));
                    }
                    if (dtlaData) {
                      notes.push(...[...dtlaData.airTransfers, ...dtlaData.seaTransfers].map(t => ({ id: t.id, note: t.note })));
                    }
                    return notes;
                  };
                  
                  // Get air transfers for LA area (LA Office + DTLA WH)
                  const getLAAirTransfers = (sku: string): TransferDetail[] => {
                    const laData = incomingFromTransfers['LA Office']?.[sku];
                    const dtlaData = incomingFromTransfers['DTLA WH']?.[sku];
                    const transfers: TransferDetail[] = [];
                    if (laData) transfers.push(...laData.airTransfers);
                    if (dtlaData) transfers.push(...dtlaData.airTransfers);
                    return transfers;
                  };
                  
                  // Get sea transfers for LA area (LA Office + DTLA WH)
                  const getLASeaTransfers = (sku: string): TransferDetail[] => {
                    const laData = incomingFromTransfers['LA Office']?.[sku];
                    const dtlaData = incomingFromTransfers['DTLA WH']?.[sku];
                    const transfers: TransferDetail[] = [];
                    if (laData) transfers.push(...laData.seaTransfers);
                    if (dtlaData) transfers.push(...dtlaData.seaTransfers);
                    return transfers;
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
                  
                  // Special case: SKUs that combine burn rates from multiple related SKUs
                  const combinedBurnRateSkus: Record<string, string[]> = {
                    'MBT3Y-DG': ['MBT24-DG', 'MBT25P-DG', 'MBT3Y-DG', 'MBTCT-DG', 'MBTMX-DG'],
                    'MBT3YRH-DG': ['MBT24RH-DG', 'MBT25PRH-DG', 'MBT3YRH-DG', 'MBTCTRH-DG', 'MBTMXRH-DG'],
                    'CTC-BKC': ['MBT24-DG', 'MBT24RH-DG', 'MBT25P-DG', 'MBT25PRH-DG', 'MBTCT-DG', 'MBTCTRH-DG', 'MBTMX-DG', 'MBTMXRH-DG'],
                  };
                  
                  // Get units per day based on selected burn period
                  const getUnitsPerDay = (sku: string): number => {
                    const skuUpper = sku.toUpperCase();
                    
                    // Check if this SKU uses combined burn rate
                    const combinedSkus = combinedBurnRateSkus[skuUpper];
                    if (combinedSkus) {
                      return combinedSkus.reduce((total, combinedSku) => {
                        const forecast = forecastingData.forecasting.find(f => f.sku.toUpperCase() === combinedSku.toUpperCase());
                        if (!forecast) return total;
                        switch (planningBurnPeriod) {
                          case '7d': return total + forecast.avgDaily7d;
                          case '21d': return total + forecast.avgDaily21d;
                          case '90d': return total + forecast.avgDaily90d;
                          default: return total + forecast.avgDaily21d;
                        }
                      }, 0);
                    }
                    
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
                  // New logic: Only include sea inventory if it arrives before runway air runs out
                  const getShipType = (
                    laInventory: number, 
                    inboundAir: number, 
                    inboundSea: number,
                    seaTransfers: TransferDetail[],
                    chinaInventory: number, 
                    unitsPerDay: number
                  ): string => {
                    // Calculate runway air date (when we run out based on LA + Air only)
                    const runwayAirDays = unitsPerDay > 0 ? (laInventory + inboundAir) / unitsPerDay : 999;
                    const runwayAirDate = new Date();
                    runwayAirDate.setDate(runwayAirDate.getDate() + runwayAirDays);
                    
                    // Check if sea transfers will arrive before runway air runs out
                    let effectiveSeaQty = 0;
                    if (seaTransfers.length > 0 && inboundSea > 0) {
                      for (const transfer of seaTransfers) {
                        if (transfer.expectedArrivalAt) {
                          const seaEta = new Date(transfer.expectedArrivalAt);
                          // If sea arrives before runway air date, include it
                          if (seaEta <= runwayAirDate) {
                            effectiveSeaQty += transfer.quantity;
                          }
                        }
                        // If no ETA, don't include the sea quantity (conservative approach)
                      }
                    }
                    
                    const effectiveIncoming = inboundAir + effectiveSeaQty;
                    const daysOfStock = unitsPerDay > 0 ? (laInventory + effectiveIncoming) / unitsPerDay : 999;
                    
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
                      case 'Prod Status': return 'bg-yellow-100 text-yellow-800';
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
                    'Prod Status': 3,
                    'No Action': 4,
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
                      const airTransfers = getLAAirTransfers(inv.sku);
                      const seaTransfers = getLASeaTransfers(inv.sku);
                      const chinaInventory = getChinaInventory(inv.sku);
                      const poQty = getPOQuantity(inv.sku);
                      const unitsPerDay = getUnitsPerDay(inv.sku);
                      
                      // Check if SKU is in phase out list
                      const isPhaseOut = phaseOutSkus.some(s => s.toLowerCase() === inv.sku.toLowerCase());
                      
                      // Effective LA inventory = LA inventory - committed (units actually available for sale)
                      const effectiveLaInventory = Math.max(0, laInventory - laCommitted);
                      
                      // Calculate total inventory across all warehouses (LA + China + Incoming + In Production)
                      const totalInventory = effectiveLaInventory + chinaInventory + incoming + poQty;
                      
                      // If phase out with no inventory anywhere, mark for filtering
                      if (isPhaseOut && totalInventory <= 0) {
                        return null; // Will be filtered out
                      }
                      
                      // For phase out SKUs: show "Phase Out" for ship type only if no China inventory
                      // If there's China inventory, use normal ship type logic
                      const shipType = (isPhaseOut && chinaInventory <= 0) ? 'Phase Out' : getShipType(effectiveLaInventory, inboundAir, inboundSea, seaTransfers, chinaInventory, unitsPerDay);
                      
                      // Calculate Runway Air (days of LA + Inbound Air only)
                      // Uses effective LA inventory (minus committed)
                      const runwayAir = unitsPerDay > 0 ? Math.round((effectiveLaInventory + inboundAir) / unitsPerDay) : 999;
                      
                      // Calculate LA Runway (days of LA + Inbound Air + Inbound Sea)
                      // Uses effective LA inventory (minus committed)
                      const laRunway = unitsPerDay > 0 ? Math.round((effectiveLaInventory + inboundAir + inboundSea) / unitsPerDay) : 999;
                      
                      // Calculate CN Runway (days of LA + Inbound Air + Inbound Sea + China)
                      // Shows total runway including China warehouse inventory
                      const cnRunway = unitsPerDay > 0 ? Math.round((effectiveLaInventory + inboundAir + inboundSea + chinaInventory) / unitsPerDay) : 999;
                      
                      // Calculate LA Need (uses selected burn rate from BR dropdown)
                      let laNeeded = 0;
                      
                      // First check: if total available (LA + Air + Sea) is below target, just return the shortfall
                      const targetInventory = planningLaTargetDays * unitsPerDay;
                      const totalAvailable = effectiveLaInventory + inboundAir + inboundSea;
                      
                      if (targetInventory > totalAvailable) {
                        // Total inventory is below target - return the delta (skip sea gap logic)
                        laNeeded = Math.ceil(targetInventory - totalAvailable);
                      } else {
                        // Total inventory meets target - apply sea gap logic
                        if (seaTransfers.length > 0 && inboundSea > 0) {
                          // Find the earliest sea ETA
                          const seaETAs = seaTransfers
                            .filter(t => t.expectedArrivalAt)
                            .map(t => new Date(t.expectedArrivalAt!))
                            .sort((a, b) => a.getTime() - b.getTime());
                          
                          if (seaETAs.length > 0) {
                            const earliestSeaETA = seaETAs[0];
                            const runwayAirDate = new Date();
                            runwayAirDate.setDate(runwayAirDate.getDate() + runwayAir);
                            
                            if (earliestSeaETA > runwayAirDate) {
                              // Gap exists: sea arrives after stockout
                              // Add 4-day buffer to account for shipping/processing time
                              const gapMs = earliestSeaETA.getTime() - runwayAirDate.getTime();
                              const gapDays = Math.ceil(gapMs / (1000 * 60 * 60 * 24));
                              laNeeded = Math.ceil((gapDays + 4) * unitsPerDay);
                            }
                            // If sea arrives before stockout, laNeeded stays 0
                          } else {
                            // Sea transfers exist but no ETA - use original logic
                            laNeeded = Math.max(0, Math.ceil((planningLaTargetDays * unitsPerDay) - (effectiveLaInventory + inboundAir)));
                          }
                        } else {
                          // No sea transfers - use original logic
                          laNeeded = Math.max(0, Math.ceil((planningLaTargetDays * unitsPerDay) - (effectiveLaInventory + inboundAir)));
                        }
                      }
                      
                      // Determine prod status based on CN runway (includes China WH) and PO (or Phase Out if applicable)
                      let prodStatus: string;
                      if (isPhaseOut) {
                        prodStatus = 'Phase Out';
                      } else {
                        const hasPO = poQty > 0;
                        if (cnRunway > 90) {
                          prodStatus = hasPO ? 'Prod Status' : 'No Action';
                        } else {
                          prodStatus = hasPO ? 'Push Vendor' : 'Order More';
                        }
                      }
                      
                      return {
                        sku: inv.sku,
                        productTitle: inv.productTitle,
                        la: effectiveLaInventory, // LA inventory minus committed
                        inboundAir,
                        inboundSea,
                        transferNotes,
                        airTransfers,
                        seaTransfers,
                        china: chinaInventory,
                        poQty,
                        unitsPerDay,
                        laNeed: laNeeded,
                        shipType,
                        runwayAir,
                        laRunway,
                        cnRunway,
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
                  // Get all product groups from unfiltered data for the dropdown
                  const allProductGroups = [...new Set(allPlanningItems.map(item => extractProductModel(item.productTitle, item.sku)))].sort((a, b) => {
                    return getModelPriority(b) - getModelPriority(a);
                  });

                  const planningItems = allPlanningItems
                    .filter(item => {
                      // Filter by search term
                      const matchesSearch = !planningSearchTerm || 
                        item.sku.toLowerCase().includes(planningSearchTerm.toLowerCase()) ||
                        item.productTitle.toLowerCase().includes(planningSearchTerm.toLowerCase());
                      // Filter by product group (multi-select)
                      const itemProductGroup = extractProductModel(item.productTitle, item.sku);
                      const matchesProduct = planningFilterProducts.length === 0 || planningFilterProducts.includes(itemProductGroup);
                      // Filter by ship type (from metric buttons) - empty array means all ship types
                      const matchesShipType = planningFilterShipTypes.length === 0 || planningFilterShipTypes.includes(item.shipType);
                      // Filter by prod status
                      const matchesProdStatus = planningFilterProdStatus === 'all' || item.prodStatus === planningFilterProdStatus;
                      return matchesSearch && matchesProduct && matchesShipType && matchesProdStatus;
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
                        case 'laRunway': comparison = a.laRunway - b.laRunway; break;
                        case 'cnRunway': comparison = a.cnRunway - b.cnRunway; break;
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
                  
                  // Helper to format runway based on toggle
                  const formatRunway = (runwayDays: number): string => {
                    if (runwayDays >= 999) return '∞';
                    if (runwayDays <= 0) return '0d';
                    if (planningRunwayDisplay === 'dates') {
                      const runoutDate = new Date();
                      runoutDate.setDate(runoutDate.getDate() + runwayDays);
                      return runoutDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
                    }
                    return `${runwayDays}d`;
                  };
                  
                  const PlanningTable = ({ items, showHeader = true }: { items: typeof planningItems; showHeader?: boolean }) => (
                    <table className="min-w-full divide-y divide-gray-200 table-fixed">
                      {showHeader && (
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-28 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('sku')}>
                              SKU <SortIcon active={planningSortBy === 'sku'} order={planningSortOrder} />
                            </th>
                            <th className="w-16 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('la')}>
                              LA <SortIcon active={planningSortBy === 'la'} order={planningSortOrder} />
                            </th>
                            <th className="w-12 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('unitsPerDay')}>
                              BR <SortIcon active={planningSortBy === 'unitsPerDay'} order={planningSortOrder} />
                            </th>
                            <th className="w-14 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('inboundAir')}>
                              Air <SortIcon active={planningSortBy === 'inboundAir'} order={planningSortOrder} />
                            </th>
                            <th className="w-14 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('inboundSea')}>
                              Sea <SortIcon active={planningSortBy === 'inboundSea'} order={planningSortOrder} />
                            </th>
                            <th className="w-14 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('china')}>
                              CN <SortIcon active={planningSortBy === 'china'} order={planningSortOrder} />
                            </th>
                            <th className="w-16 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('poQty')}>
                              Prod <SortIcon active={planningSortBy === 'poQty'} order={planningSortOrder} />
                            </th>
                            <th className="w-14 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('laNeed')}>
                              Need <SortIcon active={planningSortBy === 'laNeed'} order={planningSortOrder} />
                            </th>
                            <th className="w-24 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('shipType')}>
                              Ship <SortIcon active={planningSortBy === 'shipType'} order={planningSortOrder} />
                            </th>
                            <th className="w-28 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('prodStatus')}>
                              Prod Status <SortIcon active={planningSortBy === 'prodStatus'} order={planningSortOrder} />
                            </th>
                            <th className="w-16 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('runwayAir')}>
                              R-Air <SortIcon active={planningSortBy === 'runwayAir'} order={planningSortOrder} />
                            </th>
                            <th className="w-16 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('laRunway')}>
                              R-LA <SortIcon active={planningSortBy === 'laRunway'} order={planningSortOrder} />
                            </th>
                            <th className="w-16 px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handlePlanningSort('cnRunway')}>
                              R-CN <SortIcon active={planningSortBy === 'cnRunway'} order={planningSortOrder} />
                            </th>
                          </tr>
                        </thead>
                      )}
                      <tbody className="bg-white divide-y divide-gray-200">
                        {items.map((item, index) => {
                          const skuComment = skuComments[item.sku.toUpperCase()];
                          const commentTooltip = skuComment 
                            ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                            : undefined;
                          const isDiscontinued = DISCONTINUED_SKUS.some(s => s.toLowerCase() === item.sku.toLowerCase());
                          const isPhaseOutItem = item.prodStatus === 'Phase Out';
                          const isGrayedOut = isDiscontinued || isPhaseOutItem;
                          return (
                          <tr key={item.sku} className={isGrayedOut ? 'bg-gray-100' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                            <td className={`w-28 px-2 py-3 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`} title={commentTooltip}>
                              {item.sku}
                              {skuComment && <span className="ml-1">💬</span>}
                            </td>
                            <td className={`w-16 px-2 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.la <= 0 ? 'text-red-600 font-medium' : 'text-gray-900')}`}>{item.la.toLocaleString()}</td>
                            <td className={`w-12 px-2 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{item.unitsPerDay.toFixed(1)}</td>
                            <td 
                              className={`w-14 px-2 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.inboundAir > 0 ? 'text-purple-600 font-medium cursor-help' : 'text-gray-400')}`}
                              title={formatTransferTooltip(item.airTransfers)}
                            >
                              {item.inboundAir > 0 ? item.inboundAir.toLocaleString() : '—'}
                            </td>
                            <td 
                              className={`w-14 px-2 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.inboundSea > 0 ? 'text-blue-600 font-medium cursor-help' : 'text-gray-400')}`}
                              title={formatTransferTooltip(item.seaTransfers)}
                            >
                              {item.inboundSea > 0 ? item.inboundSea.toLocaleString() : '—'}
                            </td>
                            <td className={`w-14 px-2 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.china <= 0 ? 'text-red-600 font-medium' : 'text-gray-900')}`}>{item.china.toLocaleString()}</td>
                            <td className={`w-16 px-2 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.poQty > 0 ? 'text-blue-600 font-medium' : 'text-gray-400')}`}>{item.poQty > 0 ? item.poQty.toLocaleString() : '—'}</td>
                            <td className={`w-14 px-2 py-3 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.laNeed > 0 ? 'text-orange-600 font-medium' : 'text-gray-400')}`}>
                              {item.laNeed > 0 ? item.laNeed.toLocaleString() : '—'}
                            </td>
                            <td className="w-24 px-2 py-3 text-sm text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${isGrayedOut ? 'bg-gray-200 text-gray-500' : getShipTypeColor(item.shipType)}`}>
                                {item.shipType}
                              </span>
                            </td>
                            <td className="w-28 px-2 py-3 text-sm text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${isGrayedOut ? 'bg-gray-200 text-gray-500' : getProdStatusColor(item.prodStatus)}`}>
                                {item.prodStatus}
                              </span>
                            </td>
                            <td 
                              className={`w-16 px-2 py-3 text-sm text-center cursor-help ${isGrayedOut ? 'text-gray-500' : (item.runwayAir < 60 ? 'text-red-600 font-medium' : 'text-gray-900')}`}
                              title={`Runs out: ${getRunoutDate(item.runwayAir)}`}
                            >
                              {formatRunway(item.runwayAir)}
                            </td>
                            <td 
                              className={`w-16 px-2 py-3 text-sm text-center cursor-help ${isGrayedOut ? 'text-gray-500' : (item.laRunway < 90 ? 'text-red-600 font-medium' : 'text-gray-900')}`}
                              title={`Runs out: ${getRunoutDate(item.laRunway)}`}
                            >
                              {formatRunway(item.laRunway)}
                            </td>
                            <td 
                              className={`w-16 px-2 py-3 text-sm text-center cursor-help ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}
                              title={`Runs out: ${getRunoutDate(item.cnRunway)}`}
                            >
                              {formatRunway(item.cnRunway)}
                            </td>
                          </tr>
                        );})}
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
                            setPlanningFilterShipTypes(prev => 
                              prev.includes('Sea') 
                                ? prev.filter(t => t !== 'Sea')
                                : [...prev, 'Sea']
                            );
                          }}
                          className={`text-center bg-white shadow rounded-lg p-3 sm:p-4 border-2 transition-all cursor-pointer hover:border-green-300 ${planningFilterShipTypes.includes('Sea') ? 'border-green-500' : 'border-transparent'}`}
                        >
                          <p className="text-xs sm:text-sm font-medium text-gray-500">Sea</p>
                          <p className="text-lg sm:text-xl font-bold text-green-600">{planningMetrics.sea}</p>
                        </button>
                        <button 
                          onClick={() => {
                            setPlanningFilterProdStatus('all');
                            setPlanningFilterShipTypes(prev => 
                              prev.includes('Slow Air') 
                                ? prev.filter(t => t !== 'Slow Air')
                                : [...prev, 'Slow Air']
                            );
                          }}
                          className={`text-center bg-white shadow rounded-lg p-3 sm:p-4 border-2 transition-all cursor-pointer hover:border-blue-300 ${planningFilterShipTypes.includes('Slow Air') ? 'border-blue-500' : 'border-transparent'}`}
                        >
                          <p className="text-xs sm:text-sm font-medium text-gray-500">Slow Air</p>
                          <p className="text-lg sm:text-xl font-bold text-blue-600">{planningMetrics.slowAir}</p>
                        </button>
                        <button 
                          onClick={() => {
                            setPlanningFilterProdStatus('all');
                            setPlanningFilterShipTypes(prev => 
                              prev.includes('Express') 
                                ? prev.filter(t => t !== 'Express')
                                : [...prev, 'Express']
                            );
                          }}
                          className={`text-center bg-white shadow rounded-lg p-3 sm:p-4 border-2 transition-all cursor-pointer hover:border-orange-300 ${planningFilterShipTypes.includes('Express') ? 'border-orange-500' : 'border-transparent'}`}
                        >
                          <p className="text-xs sm:text-sm font-medium text-gray-500">Express</p>
                          <p className="text-lg sm:text-xl font-bold text-orange-600">{planningMetrics.express}</p>
                        </button>
                        <button 
                          onClick={() => {
                            setPlanningFilterShipTypes([]);
                            setPlanningFilterProducts([]);
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
                            <div className="flex flex-col relative" ref={productDropdownRef}>
                              <span className="text-[10px] text-gray-400 mb-1">Product</span>
                              <button
                                onClick={() => setShowProductDropdown(!showProductDropdown)}
                                className="h-[34px] px-3 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left flex items-center justify-between min-w-[140px]"
                              >
                                <span className="truncate">
                                  {planningFilterProducts.length === 0 
                                    ? 'All Products' 
                                    : planningFilterProducts.length === 1 
                                      ? planningFilterProducts[0]
                                      : `${planningFilterProducts.length} selected`}
                                </span>
                                <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {showProductDropdown && (
                                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 min-w-[200px] max-h-[300px] overflow-y-auto">
                                  <div className="p-2 border-b border-gray-200">
                                    <button
                                      onClick={() => setPlanningFilterProducts([])}
                                      className="text-xs text-blue-600 hover:text-blue-800"
                                    >
                                      Clear all
                                    </button>
                                  </div>
                                  {allProductGroups.map(group => (
                                    <label
                                      key={group}
                                      className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={planningFilterProducts.includes(group)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setPlanningFilterProducts([...planningFilterProducts, group]);
                                          } else {
                                            setPlanningFilterProducts(planningFilterProducts.filter(p => p !== group));
                                          }
                                        }}
                                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                      />
                                      <span className="ml-2 text-xs text-gray-700">{group}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
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
                            {/* Runway Display Toggle */}
                            <div className="flex flex-col">
                              <span className="text-[10px] text-gray-400 mb-1">Runway in</span>
                              <div className="flex items-center h-[34px] bg-gray-100 p-1 rounded-lg">
                                <button onClick={() => setPlanningRunwayDisplay('days')}
                                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${planningRunwayDisplay === 'days' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                  Days
                                </button>
                                <button onClick={() => setPlanningRunwayDisplay('dates')}
                                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${planningRunwayDisplay === 'dates' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                  Dates
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
                            {/* Comment Button */}
                            <div className="flex flex-col">
                              <span className="text-[10px] text-gray-400 mb-1">Notes</span>
                              <button
                                onClick={() => setShowSkuCommentForm(true)}
                                className="h-[34px] px-3 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                              >
                                💬 Comment
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setShowColumnDefinitions(true)}
                              className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
                            >
                              Column Info
                            </button>
                            <div className="relative" ref={planningSearchRef}>
                              {(() => {
                                const term = planningSearchTerm.toLowerCase();
                                const suggestions = showPlanningSearchSuggestions && planningSearchTerm.length >= 2 && inventoryData?.inventory
                                  ? inventoryData.inventory
                                      .filter(item => 
                                        item.sku.toLowerCase().includes(term) ||
                                        item.productTitle.toLowerCase().includes(term) ||
                                        item.variantTitle.toLowerCase().includes(term)
                                      )
                                      .slice(0, 8)
                                      .map(item => ({
                                        sku: item.sku,
                                        display: `${item.sku} - ${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`
                                      }))
                                  : [];
                                
                                return (
                                  <>
                                    <input 
                                      type="text" 
                                      placeholder="Search by SKU, product, or variant..." 
                                      value={planningSearchTerm} 
                                      onChange={(e) => {
                                        setPlanningSearchTerm(e.target.value);
                                        setShowPlanningSearchSuggestions(e.target.value.length >= 2);
                                        setPlanningSearchSuggestionIndex(-1);
                                      }}
                                      onFocus={() => {
                                        if (planningSearchTerm.length >= 2) setShowPlanningSearchSuggestions(true);
                                      }}
                                      onKeyDown={(e) => {
                                        if (!showPlanningSearchSuggestions || suggestions.length === 0) {
                                          if (e.key === 'Enter') setShowPlanningSearchSuggestions(false);
                                          return;
                                        }
                                        if (e.key === 'ArrowDown') {
                                          e.preventDefault();
                                          setPlanningSearchSuggestionIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
                                        } else if (e.key === 'ArrowUp') {
                                          e.preventDefault();
                                          setPlanningSearchSuggestionIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
                                        } else if (e.key === 'Enter') {
                                          e.preventDefault();
                                          if (planningSearchSuggestionIndex >= 0 && planningSearchSuggestionIndex < suggestions.length) {
                                            setPlanningSearchTerm(suggestions[planningSearchSuggestionIndex].sku);
                                          }
                                          setShowPlanningSearchSuggestions(false);
                                          setPlanningSearchSuggestionIndex(-1);
                                        } else if (e.key === 'Escape') {
                                          setShowPlanningSearchSuggestions(false);
                                          setPlanningSearchSuggestionIndex(-1);
                                        }
                                      }}
                                      className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                                    />
                                    {suggestions.length > 0 && (
                                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 w-full min-w-[320px] max-h-64 overflow-y-auto">
                                        {suggestions.map((s, idx) => (
                                          <button
                                            key={s.sku}
                                            type="button"
                                            onClick={() => {
                                              setPlanningSearchTerm(s.sku);
                                              setShowPlanningSearchSuggestions(false);
                                              setPlanningSearchSuggestionIndex(-1);
                                            }}
                                            className={`w-full px-3 py-2 text-left text-sm border-b border-gray-100 last:border-b-0 ${
                                              idx === planningSearchSuggestionIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-blue-50 hover:text-blue-700'
                                            }`}
                                          >
                                            <span className="font-mono font-medium">{s.sku}</span>
                                            <span className="text-gray-500 ml-2 text-xs truncate">{s.display.replace(s.sku + ' - ', '')}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Column Definitions Modal */}
                      {showColumnDefinitions && (
                        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
                            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
                              <h3 className="text-lg font-semibold text-gray-900">Column Definitions</h3>
                              <button
                                onClick={() => setShowColumnDefinitions(false)}
                                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                              >
                                ×
                              </button>
                            </div>
                            <div className="overflow-y-auto max-h-[calc(80vh-80px)]">
                              <table className="w-full">
                                <thead className="bg-gray-50 sticky top-0">
                                  <tr>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase w-28">Column</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {columnDefinitions.map((col, index) => (
                                    <tr key={col.name} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                      <td className="px-6 py-3 text-sm font-medium text-gray-900 align-top">{col.name}</td>
                                      <td className="px-6 py-3 text-sm text-gray-600 whitespace-pre-line">{col.description}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}

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
                            // Sort items within group using helper function
                            const sortedItems = sortSkusInGroup(groupedPlanning[groupName], groupName);
                            return (
                              <div key={groupName} className="bg-white shadow rounded-lg overflow-hidden">
                                <div className="bg-gray-100 px-4 py-3 border-b border-gray-200">
                                  <div className="flex justify-between items-center">
                                    <h3 className="text-sm font-semibold text-gray-900">{groupName}</h3>
                                    <div className="flex gap-4 text-xs text-gray-500">
                                      <span>{sortedItems.length} SKUs</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full divide-y divide-gray-200 table-fixed">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="w-28 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                                        <th className="w-16 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">LA</th>
                                        <th className="w-12 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">BR</th>
                                        <th className="w-14 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Air</th>
                                        <th className="w-14 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Sea</th>
                                        <th className="w-14 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">CN</th>
                                        <th className="w-16 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Prod</th>
                                        <th className="w-14 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Need</th>
                                        <th className="w-24 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Ship</th>
                                        <th className="w-28 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Prod Status</th>
                                        <th className="w-16 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">R-Air</th>
                                        <th className="w-16 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">R-LA</th>
                                        <th className="w-16 px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">R-CN</th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                      {sortedItems.map((item, index) => {
                                        const skuComment = skuComments[item.sku.toUpperCase()];
                                        const commentTooltip = skuComment 
                                          ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                                          : undefined;
                                        const isDiscontinued = DISCONTINUED_SKUS.some(s => s.toLowerCase() === item.sku.toLowerCase());
                                        const isPhaseOutItem = item.prodStatus === 'Phase Out';
                                        const isGrayedOut = isDiscontinued || isPhaseOutItem;
                                        return (
                                        <tr key={item.sku} className={isGrayedOut ? 'bg-gray-100' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                                          <td className={`w-28 px-2 py-2 text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`} title={commentTooltip}>
                                            {item.sku}
                                            {skuComment && <span className="ml-1">💬</span>}
                                          </td>
                                          <td className={`w-16 px-2 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.la <= 0 ? 'text-red-600 font-medium' : 'text-gray-900')}`}>{item.la.toLocaleString()}</td>
                                          <td className={`w-12 px-2 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}>{item.unitsPerDay.toFixed(1)}</td>
                                          <td 
                                            className={`w-14 px-2 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.inboundAir > 0 ? 'text-purple-600 font-medium cursor-help' : 'text-gray-400')}`}
                                            title={formatTransferTooltip(item.airTransfers)}
                                          >
                                            {item.inboundAir > 0 ? item.inboundAir.toLocaleString() : '—'}
                                          </td>
                                          <td 
                                            className={`w-14 px-2 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.inboundSea > 0 ? 'text-blue-600 font-medium cursor-help' : 'text-gray-400')}`}
                                            title={formatTransferTooltip(item.seaTransfers)}
                                          >
                                            {item.inboundSea > 0 ? item.inboundSea.toLocaleString() : '—'}
                                          </td>
                                          <td className={`w-14 px-2 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.china <= 0 ? 'text-red-600 font-medium' : 'text-gray-900')}`}>{item.china.toLocaleString()}</td>
                                          <td className={`w-16 px-2 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.poQty > 0 ? 'text-blue-600 font-medium' : 'text-gray-400')}`}>{item.poQty > 0 ? item.poQty.toLocaleString() : '—'}</td>
                                          <td className={`w-14 px-2 py-2 text-sm text-center ${isGrayedOut ? 'text-gray-500' : (item.laNeed > 0 ? 'text-orange-600 font-medium' : 'text-gray-400')}`}>
                                            {item.laNeed > 0 ? item.laNeed.toLocaleString() : '—'}
                                          </td>
                                          <td className="w-24 px-2 py-2 text-sm text-center">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${isGrayedOut ? 'bg-gray-200 text-gray-500' : getShipTypeColor(item.shipType)}`}>
                                              {item.shipType}
                                            </span>
                                          </td>
                                          <td className="w-28 px-2 py-2 text-sm text-center">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${isGrayedOut ? 'bg-gray-200 text-gray-500' : getProdStatusColor(item.prodStatus)}`}>
                                              {item.prodStatus}
                                            </span>
                                          </td>
                                          <td 
                                            className={`w-16 px-2 py-2 text-sm text-center cursor-help ${isGrayedOut ? 'text-gray-500' : (item.runwayAir < 60 ? 'text-red-600 font-medium' : 'text-gray-900')}`}
                                            title={`Runs out: ${getRunoutDate(item.runwayAir)}`}
                                          >
                                            {formatRunway(item.runwayAir)}
                                          </td>
                                          <td 
                                            className={`w-16 px-2 py-2 text-sm text-center cursor-help ${isGrayedOut ? 'text-gray-500' : (item.laRunway < 90 ? 'text-red-600 font-medium' : 'text-gray-900')}`}
                                            title={`Runs out: ${getRunoutDate(item.laRunway)}`}
                                          >
                                            {formatRunway(item.laRunway)}
                                          </td>
                                          <td 
                                            className={`w-16 px-2 py-2 text-sm text-center cursor-help ${isGrayedOut ? 'text-gray-500' : 'text-gray-900'}`}
                                            title={`Runs out: ${getRunoutDate(item.cnRunway)}`}
                                          >
                                            {formatRunway(item.cnRunway)}
                                          </td>
                                        </tr>
                                      );})}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Export Button */}
                      <div className="mt-6 flex flex-col items-end gap-2">
                        <button
                          onClick={() => {
                            // Build CSV content
                            const headers = ['SKU', 'Product', 'LA Stock', 'BR', 'In Air', 'In Sea', 'China', 'In Prod', 'Need', 'Ship Type', 'Prod Status', 'Runway Air', 'LA Runway', 'CN Runway', 'Transfer Notes'];
                            const rows = planningItems.map(item => [
                              item.sku,
                              `"${item.productTitle.replace(/"/g, '""')}"`,
                              item.la,
                              item.unitsPerDay.toFixed(1),
                              item.inboundAir,
                              item.inboundSea,
                              item.china,
                              item.poQty,
                              item.laNeed,
                              item.shipType,
                              item.prodStatus,
                              item.runwayAir >= 999 ? 'N/A' : `${item.runwayAir}d`,
                              item.laRunway >= 999 ? 'N/A' : `${item.laRunway}d`,
                              item.cnRunway >= 999 ? 'N/A' : `${item.cnRunway}d`,
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
                            const now = new Date();
                            const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours() % 12 || 12).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${now.getHours() >= 12 ? 'PM' : 'AM'}`;
                            link.setAttribute('download', `planning-export-${timestamp}.csv`);
                            link.style.visibility = 'hidden';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          className="px-6 py-3 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                        >
                          <span>📥</span> Export to Excel
                        </button>
                        <div className="flex gap-4">
                          <button
                            onClick={() => setShowMcEditForm(true)}
                            className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                          >
                            Manage Qty per MC
                          </button>
                          <button
                            onClick={() => setShowPhaseOutModal(true)}
                            className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                          >
                            Manage Phase Outs
                          </button>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* Inventory Tracker Tab */}
        {activeTab === 'warehouse' && (
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
                <button onClick={() => refreshAllData()} disabled={isRefreshing}
                  className={`px-4 py-2 text-sm font-medium rounded-md ${isRefreshing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                  {isRefreshing ? '⏳ Loading data from Shopify...' : '🔄 Refresh Data'}
                </button>
              </div>
            )}

            {!inventoryLoading && inventoryData && inventoryData.locationDetails && (
              (() => {
                // Get current counts for selected location
                const currentCounts = trackerCounts[trackerLocation];
                const currentDraftInfo = trackerDraftInfo[trackerLocation];
                const currentLastSubmission = trackerLastSubmission[trackerLocation];
                
                // Get data for selected location
                const locationData = inventoryData.locationDetails[trackerLocation] || [];
                
                // Get all product groups for filter dropdown
                const allTrackerProductGroups = [...new Set(locationData.map(item => extractProductModel(item.productTitle, item.sku)))].sort((a, b) => {
                  return getModelPriority(b) - getModelPriority(a);
                });
                
                // Filter by search, product, and hidden SKUs
                const filteredData = locationData.filter(item => {
                  // Hide SKUs in the hidden list
                  const isHidden = hiddenSkus.some(s => s.toLowerCase() === item.sku.toLowerCase());
                  if (isHidden) return false;
                  
                  const matchesSearch = !trackerSearchTerm || 
                    item.sku.toLowerCase().includes(trackerSearchTerm.toLowerCase()) ||
                    item.productTitle.toLowerCase().includes(trackerSearchTerm.toLowerCase()) ||
                    (item.variantTitle || '').toLowerCase().includes(trackerSearchTerm.toLowerCase());
                  
                  // Filter by product group
                  const itemProductGroup = extractProductModel(item.productTitle, item.sku);
                  const matchesProduct = trackerFilterProducts.length === 0 || trackerFilterProducts.includes(itemProductGroup);
                  
                  return matchesSearch && matchesProduct;
                });
                
                // Sort data
                const sortedData = [...filteredData].sort((a, b) => {
                  let aVal: number | string = 0;
                  let bVal: number | string = 0;
                  
                  switch (trackerSortBy) {
                    case 'sku':
                      aVal = a.sku;
                      bVal = b.sku;
                      break;
                    case 'onHand':
                      aVal = a.onHand;
                      bVal = b.onHand;
                      break;
                    case 'counted':
                      aVal = currentCounts[a.sku] ?? -Infinity;
                      bVal = currentCounts[b.sku] ?? -Infinity;
                      break;
                    case 'difference':
                      const aDiff = currentCounts[a.sku] !== null && currentCounts[a.sku] !== undefined 
                        ? currentCounts[a.sku]! - a.onHand : -Infinity;
                      const bDiff = currentCounts[b.sku] !== null && currentCounts[b.sku] !== undefined 
                        ? currentCounts[b.sku]! - b.onHand : -Infinity;
                      aVal = aDiff;
                      bVal = bDiff;
                      break;
                  }
                  
                  if (typeof aVal === 'string' && typeof bVal === 'string') {
                    return trackerSortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                  }
                  return trackerSortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
                });
                
                // Group data by product model for grouped view
                const groupedTrackerData = sortedData.reduce((groups, item) => {
                  const model = extractProductModel(item.productTitle, item.sku);
                  if (!groups[model]) groups[model] = [];
                  groups[model].push(item);
                  return groups;
                }, {} as Record<string, typeof sortedData>);
                
                const sortedTrackerGroupNames = Object.keys(groupedTrackerData).sort((a, b) => {
                  return getModelPriority(b) - getModelPriority(a);
                });
                
                // Calculate discrepancy stats (from ALL data, not just filtered)
                const allItemsWithCounts = locationData.filter(item => currentCounts[item.sku] !== null && currentCounts[item.sku] !== undefined);
                const itemsWithCounts = sortedData.filter(item => currentCounts[item.sku] !== null && currentCounts[item.sku] !== undefined);
                const discrepancies = allItemsWithCounts.filter(item => currentCounts[item.sku] !== item.onHand);
                const totalDifference = allItemsWithCounts.reduce((sum, item) => {
                  return sum + ((currentCounts[item.sku] ?? 0) - item.onHand);
                }, 0);
                
                // Render a single row
                const renderTrackerRow = (item: typeof sortedData[0], index: number) => {
                  const countedValue = currentCounts[item.sku];
                  const hasCounted = countedValue !== null && countedValue !== undefined;
                  const difference = hasCounted ? countedValue - item.onHand : null;
                  
                  const skuComment = skuComments[item.sku.toUpperCase()];
                  const commentTooltip = skuComment 
                    ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                    : undefined;
                  
                  return (
                    <tr key={item.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="pl-2 pr-1 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium text-gray-900 font-mono" title={commentTooltip}>
                        {item.sku}
                        {skuComment && <span className="ml-1">💬</span>}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-600 truncate" title={item.variantTitle}>
                        {item.variantTitle}
                      </td>
                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm text-center text-gray-900">
                        {item.onHand.toLocaleString()}
                      </td>
                      <td className="px-1 sm:px-4 py-2 sm:py-3 text-center">
                        {isReadOnly ? (
                          <span className="text-gray-500">{countedValue ?? '—'}</span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={countedValue ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value);
                              setTrackerCounts(prev => ({
                                ...prev,
                                [trackerLocation]: { ...prev[trackerLocation], [item.sku]: val },
                              }));
                            }}
                            onBlur={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value);
                              saveTrackerCount(trackerLocation, item.sku, val);
                            }}
                            className="w-14 sm:w-20 px-1 sm:px-2 py-1 text-base md:text-sm text-center border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="—"
                          />
                        )}
                      </td>
                      <td className={`px-1 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm text-center font-medium ${
                        difference === null ? 'text-gray-400' :
                        difference === 0 ? 'text-green-600' :
                        difference > 0 ? 'text-blue-600' :
                        'text-red-600'
                      }`}>
                        {difference === null ? '—' : 
                         difference === 0 ? '✓' :
                         difference > 0 ? `+${difference}` : difference}
                      </td>
                    </tr>
                  );
                };
                
                return (
                  <>
                    {/* Header with Filters */}
                    <div className="bg-white shadow rounded-lg p-4 sm:p-6 mb-4">
                      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                        <div className="flex gap-3 flex-wrap items-end">
                          {/* Location Title */}
                          <div className="flex items-center h-[34px] mr-2" style={{ width: '130px' }}>
                            <h2 className="text-2xl font-bold text-gray-900 tracking-tight uppercase whitespace-nowrap">
                              {trackerLocation}
                            </h2>
                          </div>
                          {/* Location Toggle */}
                          <div className="flex flex-col">
                            <span className="text-[10px] text-gray-400 mb-1">Location</span>
                            <div className="flex bg-gray-100 p-1 rounded-lg h-[34px] items-center">
                              {(['LA Office', 'DTLA WH', 'China WH'] as const).map(loc => (
                                <button
                                  key={loc}
                                  onClick={() => setTrackerLocation(loc)}
                                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                                    trackerLocation === loc ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                                  }`}
                                >
                                  {loc}
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* Product Filter */}
                          <div className="flex flex-col relative" ref={trackerProductDropdownRef}>
                            <span className="text-[10px] text-gray-400 mb-1">Product</span>
                            <button
                              onClick={() => setShowTrackerProductDropdown(!showTrackerProductDropdown)}
                              className="h-[34px] px-3 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left flex items-center justify-between min-w-[140px]"
                            >
                              <span className="truncate">
                                {trackerFilterProducts.length === 0 
                                  ? 'All Products' 
                                  : trackerFilterProducts.length === 1 
                                    ? trackerFilterProducts[0]
                                    : `${trackerFilterProducts.length} selected`}
                              </span>
                              <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {showTrackerProductDropdown && (
                              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 min-w-[200px] max-h-[300px] overflow-y-auto">
                                <div className="p-2 border-b border-gray-200">
                                  <button
                                    onClick={() => setTrackerFilterProducts([])}
                                    className="text-xs text-blue-600 hover:text-blue-800"
                                  >
                                    Clear all
                                  </button>
                                </div>
                                {allTrackerProductGroups.map(group => (
                                  <label
                                    key={group}
                                    className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={trackerFilterProducts.includes(group)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setTrackerFilterProducts([...trackerFilterProducts, group]);
                                        } else {
                                          setTrackerFilterProducts(trackerFilterProducts.filter(p => p !== group));
                                        }
                                      }}
                                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                    />
                                    <span className="ml-2 text-xs text-gray-700">{group}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* View Mode Toggle */}
                          <div className="flex flex-col">
                            <span className="text-[10px] text-gray-400 mb-1">View</span>
                            <div className="flex bg-gray-100 p-1 rounded-lg h-[34px] items-center">
                              <button
                                onClick={() => setTrackerViewMode('list')}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                                  trackerViewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                                }`}
                              >
                                List
                              </button>
                              <button
                                onClick={() => setTrackerViewMode('grouped')}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                                  trackerViewMode === 'grouped' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                                }`}
                              >
                                Grouped
                              </button>
                            </div>
                          </div>
                        </div>
                        {/* Search - right side */}
                        <div className="flex flex-col">
                          <div className="relative" ref={trackerSearchRef}>
                              {(() => {
                                const term = trackerSearchTerm.toLowerCase();
                                const suggestions = showTrackerSearchSuggestions && trackerSearchTerm.length >= 2 && inventoryData?.inventory
                                  ? inventoryData.inventory
                                      .filter(item => 
                                        item.sku.toLowerCase().includes(term) ||
                                        item.productTitle.toLowerCase().includes(term) ||
                                        item.variantTitle.toLowerCase().includes(term)
                                      )
                                      .slice(0, 8)
                                      .map(item => ({
                                        sku: item.sku,
                                        display: `${item.sku} - ${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`
                                      }))
                                  : [];
                                
                                return (
                                  <>
                                    <input 
                                      type="text" 
                                      placeholder="Search by SKU, product, or variant..." 
                                      value={trackerSearchTerm} 
                                      onChange={(e) => {
                                        setTrackerSearchTerm(e.target.value);
                                        setShowTrackerSearchSuggestions(e.target.value.length >= 2);
                                        setTrackerSearchSuggestionIndex(-1);
                                      }}
                                      onFocus={() => {
                                        if (trackerSearchTerm.length >= 2) setShowTrackerSearchSuggestions(true);
                                      }}
                                      onKeyDown={(e) => {
                                        if (!showTrackerSearchSuggestions || suggestions.length === 0) {
                                          if (e.key === 'Enter') setShowTrackerSearchSuggestions(false);
                                          return;
                                        }
                                        if (e.key === 'ArrowDown') {
                                          e.preventDefault();
                                          setTrackerSearchSuggestionIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
                                        } else if (e.key === 'ArrowUp') {
                                          e.preventDefault();
                                          setTrackerSearchSuggestionIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
                                        } else if (e.key === 'Enter') {
                                          e.preventDefault();
                                          if (trackerSearchSuggestionIndex >= 0 && trackerSearchSuggestionIndex < suggestions.length) {
                                            setTrackerSearchTerm(suggestions[trackerSearchSuggestionIndex].sku);
                                          }
                                          setShowTrackerSearchSuggestions(false);
                                          setTrackerSearchSuggestionIndex(-1);
                                        } else if (e.key === 'Escape') {
                                          setShowTrackerSearchSuggestions(false);
                                          setTrackerSearchSuggestionIndex(-1);
                                        }
                                      }}
                                      className="h-[34px] w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                                    />
                                    {suggestions.length > 0 && (
                                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 w-full min-w-[320px] max-h-64 overflow-y-auto">
                                        {suggestions.map((s, idx) => (
                                          <button
                                            key={s.sku}
                                            type="button"
                                            onClick={() => {
                                              setTrackerSearchTerm(s.sku);
                                              setShowTrackerSearchSuggestions(false);
                                              setTrackerSearchSuggestionIndex(-1);
                                            }}
                                            className={`w-full px-3 py-2 text-left text-sm border-b border-gray-100 last:border-b-0 ${
                                              idx === trackerSearchSuggestionIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-blue-50 hover:text-blue-700'
                                            }`}
                                          >
                                            <span className="font-mono font-medium">{s.sku}</span>
                                            <span className="text-gray-500 ml-2 text-xs truncate">{s.display.replace(s.sku + ' - ', '')}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                      </div>
                    </div>
                    
                    {/* Action Bar */}
                    <div className="bg-white shadow rounded-lg p-4 mb-4">
                      <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
                        {/* Left: Stats and Draft Info */}
                        <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                          {/* Stats */}
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">Counted:</span>
                              <span className="font-semibold text-gray-900">{allItemsWithCounts.length}</span>
                              <span className="text-gray-400">/ {locationData.length} SKUs</span>
                            </div>
                            {discrepancies.length > 0 && (
                              <div className="flex items-center gap-2 text-orange-600">
                                <span>⚠️</span>
                                <span className="font-semibold">{discrepancies.length}</span>
                                <span>discrepancies</span>
                              </div>
                            )}
                          </div>
                          {/* Draft/Submission Info */}
                          {currentDraftInfo && (
                            <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
                              💾 Draft: {formatBadgeDate(currentDraftInfo.savedAt)} by {currentDraftInfo.savedBy}
                            </div>
                          )}
                          {!currentDraftInfo && currentLastSubmission && (
                            <div className={`text-xs px-3 py-1.5 rounded-full ${
                              currentLastSubmission.isTest 
                                ? 'text-amber-700 bg-amber-100' 
                                : 'text-green-700 bg-green-100'
                            }`}>
                              {currentLastSubmission.isTest ? '🧪 Test: ' : '✓ Submitted: '}
                              {formatBadgeDate(currentLastSubmission.submittedAt)} by {currentLastSubmission.submittedBy}
                            </div>
                          )}
                        </div>
                        
                        {/* Right: Action Buttons */}
                        <div className="flex items-center gap-3">
                          {/* Hidden SKUs Link */}
                          <button
                            onClick={() => setShowHiddenSkusModal(true)}
                            className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                          >
                            Hidden SKUs{hiddenSkus.length > 0 ? ` (${hiddenSkus.length})` : ''}
                          </button>
                          {/* View Logs Button - hidden on mobile (portrait & landscape) */}
                          <button
                            onClick={() => {
                              loadTrackerLogs(trackerLocation);
                              setShowTrackerLogs(true);
                            }}
                            className="hidden md:block px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
                          >
                            📋 View Logs
                          </button>
                          {/* Clear Button - hidden for read-only users */}
                          {!isReadOnly && allItemsWithCounts.length > 0 && (
                            <button
                              onClick={() => setShowTrackerClearConfirm(true)}
                              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
                            >
                              🗑️ Clear All
                            </button>
                          )}
                          {/* Save Draft Button - hidden for read-only users */}
                          {!isReadOnly && (
                            <button
                              onClick={() => saveDraftToGoogleDrive(trackerLocation)}
                              disabled={isSavingDraft || allItemsWithCounts.length === 0}
                              className={`px-4 py-2 text-sm font-medium rounded-md ${
                                isSavingDraft || allItemsWithCounts.length === 0
                                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              {isSavingDraft ? '⏳ Saving...' : '💾 Save Draft'}
                            </button>
                          )}
                          {/* Submit Button - hidden on mobile and for read-only users */}
                          {!isReadOnly && (
                            <button
                              onClick={() => setShowTrackerConfirm(true)}
                              disabled={allItemsWithCounts.length === 0}
                              className={`hidden md:block px-4 py-2 text-sm font-medium rounded-md ${
                                allItemsWithCounts.length === 0 
                                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                                  : 'bg-green-600 text-white hover:bg-green-700'
                              }`}
                            >
                              ✅ Submit to Shopify
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="bg-white shadow rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full divide-y divide-gray-200 sm:table-fixed">
                          {/* Column widths for desktop only */}
                          <colgroup className="hidden sm:table-column-group">
                            <col style={{ width: '130px' }} />
                            <col style={{ width: '280px' }} />
                            <col style={{ width: '100px' }} />
                            <col style={{ width: '120px' }} />
                            <col style={{ width: '110px' }} />
                          </colgroup>
                          <thead className="bg-gray-50">
                            <tr>
                              <th 
                                className="pl-2 pr-1 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                                onClick={() => {
                                  if (trackerSortBy === 'sku') {
                                    setTrackerSortOrder(trackerSortOrder === 'asc' ? 'desc' : 'asc');
                                  } else {
                                    setTrackerSortBy('sku');
                                    setTrackerSortOrder('asc');
                                  }
                                }}
                              >
                                SKU {trackerSortBy === 'sku' && (trackerSortOrder === 'asc' ? '↑' : '↓')}
                              </th>
                              <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                Variant
                              </th>
                              <th 
                                className="px-1 sm:px-4 py-2 sm:py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                                onClick={() => {
                                  if (trackerSortBy === 'onHand') {
                                    setTrackerSortOrder(trackerSortOrder === 'asc' ? 'desc' : 'asc');
                                  } else {
                                    setTrackerSortBy('onHand');
                                    setTrackerSortOrder('desc');
                                  }
                                }}
                              >
                                On Hand{trackerSortBy === 'onHand' && (trackerSortOrder === 'asc' ? ' ↑' : ' ↓')}
                              </th>
                              <th 
                                className="px-1 sm:px-4 py-2 sm:py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                                onClick={() => {
                                  if (trackerSortBy === 'counted') {
                                    setTrackerSortOrder(trackerSortOrder === 'asc' ? 'desc' : 'asc');
                                  } else {
                                    setTrackerSortBy('counted');
                                    setTrackerSortOrder('desc');
                                  }
                                }}
                              >
                                <span className="hidden sm:inline">Counted</span>
                                <span className="sm:hidden">Count</span>
                                {trackerSortBy === 'counted' && (trackerSortOrder === 'asc' ? ' ↑' : ' ↓')}
                              </th>
                              <th 
                                className="px-1 sm:px-4 py-2 sm:py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                                onClick={() => {
                                  if (trackerSortBy === 'difference') {
                                    setTrackerSortOrder(trackerSortOrder === 'asc' ? 'desc' : 'asc');
                                  } else {
                                    setTrackerSortBy('difference');
                                    setTrackerSortOrder('desc');
                                  }
                                }}
                              >
                                <span className="hidden sm:inline">Difference</span>
                                <span className="sm:hidden">Diff</span>
                                {trackerSortBy === 'difference' && (trackerSortOrder === 'asc' ? ' ↑' : ' ↓')}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {trackerViewMode === 'list' ? (
                              sortedData.map((item, index) => renderTrackerRow(item, index))
                            ) : (
                              sortedTrackerGroupNames.map(groupName => {
                                // Sort items within group using helper function
                                const sortedGroupItems = sortSkusInGroup(groupedTrackerData[groupName], groupName);
                                return (
                                  <Fragment key={groupName}>
                                    {/* Group Header */}
                                    <tr className="bg-blue-50 border-t-2 border-blue-200">
                                      <td colSpan={5} className="px-4 py-2">
                                        <span className="text-sm font-semibold text-blue-800">{groupName}</span>
                                        <span className="ml-2 text-xs text-blue-600">({sortedGroupItems.length} SKUs)</span>
                                      </td>
                                    </tr>
                                    {/* Group Items */}
                                    {sortedGroupItems.map((item, index) => renderTrackerRow(item, index))}
                                  </Fragment>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                      {sortedData.length === 0 && (
                        <div className="p-8 text-center text-gray-500">
                          No inventory items found.
                        </div>
                      )}
                    </div>

                    {/* Export Section - hidden on mobile (portrait & landscape) */}
                    {sortedData.length > 0 && (
                      <div className="hidden md:flex mt-4 justify-end">
                        <button
                          onClick={() => {
                            // Build CSV content with all visible data
                            const headers = ['SKU', 'Variant', 'On Hand', 'Counted', 'Difference'];
                            const rows = sortedData.map(item => {
                              const counted = currentCounts[item.sku];
                              const hasCounted = counted !== null && counted !== undefined;
                              const difference = hasCounted ? counted - item.onHand : '';
                              return [
                                item.sku,
                                `"${item.variantTitle.replace(/"/g, '""')}"`,
                                item.onHand,
                                hasCounted ? counted : '',
                                difference,
                              ].join(',');
                            });
                            
                            const csvContent = [headers.join(','), ...rows].join('\n');
                            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                            const link = document.createElement('a');
                            const url = URL.createObjectURL(blob);
                            link.setAttribute('href', url);
                            const now = new Date();
                            const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours() % 12 || 12).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${now.getHours() >= 12 ? 'PM' : 'AM'}`;
                            link.setAttribute('download', `inventory-counts-${trackerLocation.replace(/\s/g, '-')}-${timestamp}.csv`);
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
                    )}

                    {/* Clear Confirmation Modal */}
                    {showTrackerClearConfirm && (
                      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                          <div className="px-6 py-4 border-b border-gray-200">
                            <h3 className="text-lg font-semibold text-gray-900">Clear All Counts</h3>
                          </div>
                          <div className="px-6 py-4">
                            <p className="text-sm text-gray-600 mb-2">
                              Are you sure you want to clear all counted values for <strong>{trackerLocation}</strong>?
                            </p>
                            <p className="text-sm text-red-600 font-medium">
                              ⚠️ This will clear the shared draft for everyone on the team.
                            </p>
                            <p className="text-sm text-gray-500 mt-2">
                              This will remove {allItemsWithCounts.length} counted SKUs. This action cannot be undone.
                            </p>
                          </div>
                          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                            <button
                              onClick={() => setShowTrackerClearConfirm(false)}
                              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md text-sm font-medium"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => clearTrackerCounts(trackerLocation)}
                              className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700"
                            >
                              Clear All
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Confirmation Modal */}
                    {showTrackerConfirm && (() => {
                      // Find SKUs with large discrepancies (difference > 50 or < -50)
                      const largeDiscrepancies = allItemsWithCounts.filter(item => {
                        const diff = (currentCounts[item.sku] ?? 0) - item.onHand;
                        return Math.abs(diff) > 50;
                      });
                      
                      return (
                        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
                            <div className="px-6 py-4 border-b border-gray-200">
                              <h3 className="text-lg font-semibold text-gray-900">Submit Inventory Counts to Shopify</h3>
                            </div>
                            <div className="px-6 py-4">
                              <p className="text-sm text-gray-600 mb-4">
                                Are you sure you want to submit these inventory counts to Shopify?
                              </p>
                              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-600">SKUs counted:</span>
                                  <span className="font-medium">{allItemsWithCounts.length}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-600">SKUs with discrepancies:</span>
                                  <span className={`font-medium ${discrepancies.length > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                                    {discrepancies.length}
                                  </span>
                                </div>
                                <div className="flex justify-between text-sm border-t border-gray-200 pt-2 mt-2">
                                  <span className="text-gray-600">Total unit difference:</span>
                                  <span className={`font-medium ${
                                    totalDifference === 0 ? 'text-green-600' :
                                    totalDifference > 0 ? 'text-blue-600' : 'text-red-600'
                                  }`}>
                                    {totalDifference > 0 ? `+${totalDifference}` : totalDifference}
                                  </span>
                                </div>
                              </div>
                              
                              {/* Large Discrepancy Warning */}
                              {largeDiscrepancies.length > 0 && (
                                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                                  <div className="flex items-start gap-2">
                                    <span className="text-amber-600 text-lg">⚠️</span>
                                    <div className="flex-1">
                                      <p className="text-sm font-medium text-amber-800">
                                        Large discrepancies detected ({largeDiscrepancies.length} SKU{largeDiscrepancies.length > 1 ? 's' : ''})
                                      </p>
                                      <p className="text-xs text-amber-700 mt-1">
                                        The following SKUs have a difference greater than 50 units. Please verify these counts are correct.
                                      </p>
                                      <div className="mt-3 max-h-40 overflow-y-auto">
                                        <table className="w-full text-xs">
                                          <thead className="bg-amber-100">
                                            <tr>
                                              <th className="px-2 py-1 text-left text-amber-800">SKU</th>
                                              <th className="px-2 py-1 text-center text-amber-800">System</th>
                                              <th className="px-2 py-1 text-center text-amber-800">Counted</th>
                                              <th className="px-2 py-1 text-center text-amber-800">Diff</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {largeDiscrepancies.map(item => {
                                              const counted = currentCounts[item.sku] ?? 0;
                                              const diff = counted - item.onHand;
                                              const skuComment = skuComments[item.sku.toUpperCase()];
                                              const commentTooltip = skuComment 
                                                ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                                                : undefined;
                                              return (
                                                <tr key={item.sku} className="border-t border-amber-200">
                                                  <td className="px-2 py-1 font-mono text-amber-900" title={commentTooltip}>
                                                    {item.sku}
                                                    {skuComment && <span className="ml-1">💬</span>}
                                                  </td>
                                                  <td className="px-2 py-1 text-center text-amber-900">{item.onHand}</td>
                                                  <td className="px-2 py-1 text-center text-amber-900">{counted}</td>
                                                  <td className={`px-2 py-1 text-center font-medium ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                                    {diff > 0 ? `+${diff}` : diff}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                              
                            <p className="text-xs text-gray-500 mt-4">
                              This will update the on-hand quantities in Shopify for all {allItemsWithCounts.length} counted SKUs.
                            </p>
                            
                            {/* Test Mode Toggle */}
                            <label className="flex items-center gap-2 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                              <input
                                type="checkbox"
                                checked={trackerTestMode}
                                onChange={(e) => setTrackerTestMode(e.target.checked)}
                                className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                              />
                              <div>
                                <span className="text-sm font-medium text-amber-800">Test Mode</span>
                                <p className="text-xs text-amber-600">Skip Shopify update, only save to logs</p>
                              </div>
                            </label>
                          </div>
                          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                            <button
                              onClick={() => setShowTrackerConfirm(false)}
                              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md text-sm font-medium"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={async () => {
                                  setIsSubmittingTracker(true);
                                  setGlobalStatus({ 
                                    message: trackerTestMode ? 'Processing Test Submission...' : 'Updating Shopify Inventory...', 
                                    subMessage: 'Please do not close this window' 
                                  });
                                  try {
                                    // Get the location ID for current tracker location
                                    const locationId = inventoryData?.locationIds?.[trackerLocation];
                                    
                                    // In test mode, we don't need the location ID
                                    if (!locationId && !trackerTestMode) {
                                      throw new Error(`${trackerLocation} location ID not found. Please click "Refresh Data" to update the inventory data.`);
                                    }
                                    
                                    // Build updates array - only counted SKUs
                                    // Special handling for SKUs that map to multiple Shopify variants
                                    const MULTI_VARIANT_SKUS = [
                                      {
                                        sku: 'MBT3Y-DG',
                                        // Model 3 / 2017-2023 / Left Hand = 35%, Model Y / 2010-2024 / Left Hand = 65%
                                        allocations: [
                                          { variantMatch: 'Model 3', percentage: 0.35 },
                                          { variantMatch: 'Model Y', percentage: 0.65 },
                                        ],
                                      },
                                      {
                                        sku: 'MBT3YRH-DG',
                                        // Model 3 / 2017-2023 / Right Hand = 35%, Model Y / 2010-2024 / Right Hand = 65%
                                        allocations: [
                                          { variantMatch: 'Model 3', percentage: 0.35 },
                                          { variantMatch: 'Model Y', percentage: 0.65 },
                                        ],
                                      },
                                    ];
                                    
                                    const updates: Array<{ sku: string; inventoryItemId: string; quantity: number; locationId: string }> = [];
                                    
                                    for (const item of allItemsWithCounts) {
                                      const quantity = currentCounts[item.sku] ?? 0;
                                      const locId = locationId || 'test-mode';
                                      
                                      // Check if this SKU needs to be split between multiple variants
                                      const splitConfig = MULTI_VARIANT_SKUS.find(s => s.sku === item.sku);
                                      
                                      if (splitConfig && item.variantInventoryItems && item.variantInventoryItems.length > 1) {
                                        // Split the counted quantity between variants
                                        let remainingQty = quantity;
                                        
                                        for (let i = 0; i < splitConfig.allocations.length; i++) {
                                          const allocation = splitConfig.allocations[i];
                                          const variant = item.variantInventoryItems.find(v => v.variantTitle.includes(allocation.variantMatch));
                                          
                                          if (variant) {
                                            // Last allocation gets remainder to ensure total matches
                                            const allocatedQty = i === splitConfig.allocations.length - 1
                                              ? remainingQty
                                              : Math.round(quantity * allocation.percentage);
                                            
                                            updates.push({
                                              sku: `${item.sku} (${allocation.variantMatch})`,
                                              inventoryItemId: variant.inventoryItemId,
                                              quantity: allocatedQty,
                                              locationId: locId,
                                            });
                                            
                                            remainingQty -= allocatedQty;
                                          }
                                        }
                                      } else {
                                        // Normal SKU - single update
                                        updates.push({
                                          sku: item.sku,
                                          inventoryItemId: item.inventoryItemId,
                                          quantity,
                                          locationId: locId,
                                        });
                                      }
                                    }
                                    
                                    let result;
                                    
                                    if (trackerTestMode) {
                                      // Test mode - simulate success without calling Shopify
                                      result = {
                                        summary: {
                                          total: updates.length,
                                          success: updates.length,
                                          failed: 0,
                                        }
                                      };
                                    } else {
                                      // Submit to Shopify
                                      const response = await fetch('/api/inventory/update', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ updates }),
                                      });
                                      
                                      result = await response.json();
                                      
                                      if (!response.ok) {
                                        throw new Error(result.error || 'Failed to update inventory');
                                      }
                                    }
                                    
                                    // Save to submission log in Google Drive
                                    const logEntry = {
                                      timestamp: new Date().toISOString(),
                                      submittedBy: (trackerTestMode ? '[TEST] ' : '') + (session?.user?.name || 'Unknown'),
                                      testMode: trackerTestMode,
                                      summary: {
                                        totalSKUs: updates.length,
                                        discrepancies: discrepancies.length,
                                        totalDifference,
                                      },
                                      updates: updates.map(u => ({
                                        sku: u.sku,
                                        previousOnHand: allItemsWithCounts.find(i => i.sku === u.sku)?.onHand ?? 0,
                                        newQuantity: u.quantity,
                                      })),
                                      result: result.summary,
                                    };
                                    
                                    // Save log to Google Drive
                                    try {
                                      await fetch('/api/warehouse/logs', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ log: logEntry, location: trackerLocation }),
                                      });
                                    } catch (logError) {
                                      console.error('Failed to save log to Google Drive:', logError);
                                    }
                                    
                                    // Delete shared draft from Google Drive for this location (data is now in logs)
                                    try {
                                      await fetch(`/api/warehouse/draft?location=${encodeURIComponent(trackerLocation)}`, { method: 'DELETE' });
                                      setDraftContributors([]);
                                      setCountDetails({});
                                    } catch (draftError) {
                                      console.error('Failed to delete draft:', draftError);
                                    }
                                    
                                    // Always clear local draft info after successful submission
                                    setTrackerDraftInfo(prev => ({ ...prev, [trackerLocation]: null }));
                                    
                                    // Clear counts for this location on success
                                    startTransition(() => {
                                      setTrackerCounts(prev => ({ ...prev, [trackerLocation]: {} }));
                                    });
                                    const localKey = `trackerCounts_${trackerLocation.replace(/\s/g, '_')}`;
                                    localStorage.removeItem(localKey);
                                    
                                    // Track last submission info
                                    setTrackerLastSubmission(prev => ({
                                      ...prev,
                                      [trackerLocation]: {
                                        submittedAt: logEntry.timestamp,
                                        submittedBy: trackerTestMode ? (session?.user?.name || 'Unknown') : logEntry.submittedBy,
                                        skuCount: updates.length,
                                        isTest: trackerTestMode,
                                      },
                                    }));
                                    
                                    if (trackerTestMode) {
                                      showTrackerNotification('success', 'Test Submission Logged', 
                                        `${updates.length} SKUs logged (Shopify not updated). Check logs to verify.`);
                                    } else if (result.summary.failed > 0) {
                                      // Get the first error message from failed results
                                      const failedResults = result.results?.filter((r: { success: boolean }) => !r.success) || [];
                                      const firstError = failedResults[0]?.error || 'Unknown error';
                                      showTrackerNotification('warning', 'Update Failed', 
                                        `${result.summary.success} succeeded, ${result.summary.failed} failed. Error: ${firstError}`);
                                    } else {
                                      showTrackerNotification('success', 'Inventory Updated', 
                                        `Successfully updated ${result.summary.success} SKUs in Shopify.`);
                                    }
                                    
                                    // Update local inventory data to reflect submitted counts (temporary until next refresh)
                                    if (!trackerTestMode && inventoryData) {
                                      setInventoryData(prev => {
                                        if (!prev) return prev;
                                        
                                        // Create a map of SKU -> new quantity from updates
                                        const updateMap = new Map(updates.map(u => [u.sku, u.quantity]));
                                        
                                        // Update locationDetails for the tracker location
                                        const updatedLocationDetails = { ...prev.locationDetails };
                                        if (updatedLocationDetails[trackerLocation]) {
                                          updatedLocationDetails[trackerLocation] = updatedLocationDetails[trackerLocation].map(item => {
                                            const newQty = updateMap.get(item.sku);
                                            if (newQty !== undefined) {
                                              // Calculate the difference to adjust available (onHand change affects available)
                                              const diff = newQty - item.onHand;
                                              return {
                                                ...item,
                                                onHand: newQty,
                                                available: Math.max(0, item.available + diff),
                                              };
                                            }
                                            return item;
                                          });
                                        }
                                        
                                        // Update main inventory array totals
                                        const updatedInventory = prev.inventory.map(item => {
                                          const newQty = updateMap.get(item.sku);
                                          if (newQty !== undefined) {
                                            const oldQty = item.locations[trackerLocation] || 0;
                                            const diff = newQty - oldQty;
                                            return {
                                              ...item,
                                              locations: {
                                                ...item.locations,
                                                [trackerLocation]: newQty,
                                              },
                                              totalAvailable: item.totalAvailable + diff,
                                            };
                                          }
                                          return item;
                                        });
                                        
                                        return {
                                          ...prev,
                                          locationDetails: updatedLocationDetails,
                                          inventory: updatedInventory,
                                        };
                                      });
                                    }
                                    
                                  } catch (error) {
                                    console.error('Submission failed:', error);
                                    showTrackerNotification('error', 'Submission Failed', 
                                      error instanceof Error ? error.message : 'Unknown error');
                                  } finally {
                                    setGlobalStatus(null);
                                    setIsSubmittingTracker(false);
                                    setShowTrackerConfirm(false);
                                  }
                                }}
                                disabled={isSubmittingTracker}
                                className={`px-4 py-2 rounded-md text-sm font-medium ${
                                  isSubmittingTracker
                                    ? 'bg-green-400 text-white cursor-not-allowed'
                                    : 'bg-green-600 text-white hover:bg-green-700'
                                }`}
                              >
                                {isSubmittingTracker ? 'Submitting...' : 'Yes, Submit to Shopify'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    
                    {/* Submission Logs Modal */}
                    {showTrackerLogs && (
                      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
                          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                            <h3 className="text-lg font-semibold text-gray-900">Submission Logs</h3>
                            <button
                              onClick={() => setShowTrackerLogs(false)}
                              className="text-gray-400 hover:text-gray-600"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="flex-1 overflow-y-auto p-6">
                            {isLoadingLogs ? (
                              <div className="flex items-center justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                <span className="ml-3 text-gray-600">Loading logs from Google Drive...</span>
                              </div>
                            ) : trackerLogs.length === 0 ? (
                              <p className="text-gray-500 text-center py-8">No submission logs yet.</p>
                            ) : (
                              <div className="space-y-4">
                                {trackerLogs.map((log, index) => (
                                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                                    <div className="flex justify-between items-start mb-3">
                                      <div>
                                        <p className="text-sm font-medium text-gray-900">
                                          {new Date(log.timestamp).toLocaleString()}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                          Submitted by: {log.submittedBy}
                                        </p>
                                      </div>
                                      <div className="text-right">
                                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                          log.result.failed === 0 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                        }`}>
                                          {log.result.success}/{log.result.total} success
                                        </span>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                                      <div className="bg-gray-50 rounded p-2">
                                        <span className="text-gray-500">SKUs Updated:</span>
                                        <span className="ml-2 font-medium">{log.summary.totalSKUs}</span>
                                      </div>
                                      <div className="bg-gray-50 rounded p-2">
                                        <span className="text-gray-500">Discrepancies:</span>
                                        <span className="ml-2 font-medium">{log.summary.discrepancies}</span>
                                      </div>
                                      <div className="bg-gray-50 rounded p-2">
                                        <span className="text-gray-500">Total Diff:</span>
                                        <span className={`ml-2 font-medium ${
                                          log.summary.totalDifference > 0 ? 'text-blue-600' : 
                                          log.summary.totalDifference < 0 ? 'text-red-600' : 'text-green-600'
                                        }`}>
                                          {log.summary.totalDifference > 0 ? '+' : ''}{log.summary.totalDifference}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                      <details className="flex-1">
                                        <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                                          View {log.updates.length} SKU details
                                        </summary>
                                        <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded">
                                        <table className="w-full">
                                          <thead className="bg-gray-50 sticky top-0">
                                            <tr>
                                              <th className="px-2 py-1 text-left text-gray-600">SKU</th>
                                              <th className="px-2 py-1 text-center text-gray-600">Previous</th>
                                              <th className="px-2 py-1 text-center text-gray-600">New</th>
                                              <th className="px-2 py-1 text-center text-gray-600">Change</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {log.updates.map((update, idx) => {
                                              const diff = update.newQuantity - update.previousOnHand;
                                              return (
                                                <tr key={idx} className="border-t border-gray-100">
                                                  <td className="px-2 py-1 font-mono">{update.sku}</td>
                                                  <td className="px-2 py-1 text-center">{update.previousOnHand}</td>
                                                  <td className="px-2 py-1 text-center">{update.newQuantity}</td>
                                                  <td className={`px-2 py-1 text-center font-medium ${
                                                    diff > 0 ? 'text-blue-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'
                                                  }`}>
                                                    {diff === 0 ? '—' : diff > 0 ? `+${diff}` : diff}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                      </details>
                                      <button
                                        onClick={() => exportLogToExcel(log, log.location || trackerLocation)}
                                        className="ml-4 text-green-600 hover:text-green-800 hover:underline whitespace-nowrap"
                                      >
                                        📥 Export to Excel
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
                            <span className="text-xs text-gray-500 self-center">
                              Logs are stored in Google Drive
                            </span>
                            <button
                              onClick={() => setShowTrackerLogs(false)}
                              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md text-sm font-medium"
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Toast Notification */}
                    {trackerNotification && (
                      <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
                        <div className={`flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border ${
                          trackerNotification.type === 'success' 
                            ? 'bg-green-50 border-green-200' 
                            : trackerNotification.type === 'warning'
                            ? 'bg-amber-50 border-amber-200'
                            : 'bg-red-50 border-red-200'
                        }`}>
                          <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                            trackerNotification.type === 'success'
                              ? 'bg-green-100 text-green-600'
                              : trackerNotification.type === 'warning'
                              ? 'bg-amber-100 text-amber-600'
                              : 'bg-red-100 text-red-600'
                          }`}>
                            {trackerNotification.type === 'success' ? '✓' : 
                             trackerNotification.type === 'warning' ? '!' : '✕'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${
                              trackerNotification.type === 'success'
                                ? 'text-green-800'
                                : trackerNotification.type === 'warning'
                                ? 'text-amber-800'
                                : 'text-red-800'
                            }`}>
                              {trackerNotification.title}
                            </p>
                            <p className={`text-sm mt-0.5 ${
                              trackerNotification.type === 'success'
                                ? 'text-green-600'
                                : trackerNotification.type === 'warning'
                                ? 'text-amber-600'
                                : 'text-red-600'
                            }`}>
                              {trackerNotification.message}
                            </p>
                          </div>
                          <button
                            onClick={() => setTrackerNotification(null)}
                            className={`flex-shrink-0 p-1 rounded hover:bg-opacity-20 ${
                              trackerNotification.type === 'success'
                                ? 'text-green-500 hover:bg-green-500'
                                : trackerNotification.type === 'warning'
                                ? 'text-amber-500 hover:bg-amber-500'
                                : 'text-red-500 hover:bg-red-500'
                            }`}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </>
        )}

        {/* Production Tab */}
        {activeTab === 'production' && (
          <div className="space-y-4">
            {/* Filtering Block */}
            <div className="bg-white shadow rounded-lg p-4">
              {/* Single Row with All Filters */}
              <div className="flex items-center justify-between gap-3">
                {/* Left side: View Toggle + Filters */}
                <div className="flex items-center gap-3">
                  {/* View Toggle */}
                  <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                      onClick={() => setProductionViewType('orders')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        productionViewType === 'orders' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Production
                    </button>
                    <button
                      onClick={() => setProductionViewType('transfers')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        productionViewType === 'transfers' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Transfers
                    </button>
                  </div>
                  
                  {productionViewType === 'orders' ? (
                    <>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-600 whitespace-nowrap">Status:</label>
                        <select
                          value={productionFilterStatus}
                          onChange={(e) => setProductionFilterStatus(e.target.value as 'all' | 'open' | 'completed')}
                          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                        >
                          <option value="all">All Orders</option>
                          <option value="open">Open Orders</option>
                          <option value="completed">Completed</option>
                        </select>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-600 whitespace-nowrap">Period:</label>
                        <select
                          value={poDateFilter}
                          onChange={(e) => setPoDateFilter(e.target.value)}
                          className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="all">All Time</option>
                          <option value="1m">Last 1 Month</option>
                          <option value="3m">Last 3 Months</option>
                          <option value="6m">Last 6 Months</option>
                          <option value="1y">Last 1 Year</option>
                          <option value="2y">Last 2 Years</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-600 whitespace-nowrap">Status:</label>
                        <select
                          value={transferFilterStatus}
                          onChange={(e) => setTransferFilterStatus(e.target.value as 'all' | 'active' | 'completed')}
                          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                        >
                          <option value="all">All Transfers</option>
                          <option value="active">Active</option>
                          <option value="completed">Completed</option>
                        </select>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-600 whitespace-nowrap">Period:</label>
                        <select
                          value={transferDateFilter}
                          onChange={(e) => setTransferDateFilter(e.target.value)}
                          className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="all">All Time</option>
                          <option value="1m">Last 1 Month</option>
                          <option value="3m">Last 3 Months</option>
                          <option value="6m">Last 6 Months</option>
                          <option value="1y">Last 1 Year</option>
                          <option value="2y">Last 2 Years</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>
                
                {/* Right side: Search + Clear + Action Button */}
                {productionViewType === 'orders' ? (
                  <div className="flex items-center gap-3">
                  <div className="relative" ref={skuSearchRef}>
                    <div className="relative">
                      {(() => {
                        const term = skuSearchQuery.toLowerCase();
                        const suggestions = showSkuSearchSuggestions && skuSearchQuery.length >= 2 && inventoryData?.inventory
                          ? inventoryData.inventory
                              .filter(item => 
                                item.sku.toLowerCase().includes(term) ||
                                item.productTitle.toLowerCase().includes(term) ||
                                item.variantTitle.toLowerCase().includes(term)
                              )
                              .slice(0, 8)
                              .map(item => ({
                                sku: item.sku,
                                display: `${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`
                              }))
                          : [];
                        
                        return (
                          <>
                            <input
                              type="text"
                              value={skuSearchQuery}
                              onChange={(e) => {
                                const value = e.target.value;
                                setSkuSearchQuery(value);
                                setShowSkuSearchSuggestions(value.length >= 2);
                                setSkuSearchSuggestionIndex(-1);
                                if (skuSearchSelected && value.toUpperCase() !== skuSearchSelected) {
                                  setSkuSearchSelected('');
                                }
                              }}
                              onFocus={() => {
                                if (skuSearchQuery.length >= 2) {
                                  setShowSkuSearchSuggestions(true);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (!showSkuSearchSuggestions || suggestions.length === 0) {
                                  if (e.key === 'Enter') setShowSkuSearchSuggestions(false);
                                  return;
                                }
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setSkuSearchSuggestionIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setSkuSearchSuggestionIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
                                } else if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (skuSearchSuggestionIndex >= 0 && skuSearchSuggestionIndex < suggestions.length) {
                                    setSkuSearchQuery(suggestions[skuSearchSuggestionIndex].sku);
                                    setSkuSearchSelected(suggestions[skuSearchSuggestionIndex].sku);
                                    setProductionFilterStatus('all');
                                  }
                                  setShowSkuSearchSuggestions(false);
                                  setSkuSearchSuggestionIndex(-1);
                                } else if (e.key === 'Escape') {
                                  setShowSkuSearchSuggestions(false);
                                  setSkuSearchSuggestionIndex(-1);
                                }
                              }}
                              placeholder="Search by SKU, product, or variant..."
                              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-64"
                            />
                            {suggestions.length > 0 && (
                              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-[320px] max-h-64 overflow-y-auto">
                                {suggestions.map((s, idx) => (
                                  <button
                                    key={s.sku}
                                    type="button"
                                    onClick={() => {
                                      setSkuSearchQuery(s.sku);
                                      setSkuSearchSelected(s.sku);
                                      setShowSkuSearchSuggestions(false);
                                      setSkuSearchSuggestionIndex(-1);
                                      setProductionFilterStatus('all');
                                    }}
                                    className={`w-full px-3 py-2 text-left text-sm border-b border-gray-100 last:border-b-0 ${
                                      idx === skuSearchSuggestionIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-blue-50 hover:text-blue-700'
                                    }`}
                                  >
                                    <span className="font-mono font-medium">{s.sku}</span>
                                    <span className="text-gray-500 ml-2 text-xs truncate block">{s.display}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {(skuSearchSelected || poDateFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSkuSearchQuery('');
                        setSkuSearchSelected('');
                        setPoDateFilter('all');
                      }}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Clear
                    </button>
                  )}
                  
                  {/* Action Button - hidden for read-only users */}
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => setShowNewOrderForm(true)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
                    >
                      + New Production
                    </button>
                  )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                  <div className="relative" ref={transferSkuSearchRef}>
                    <div className="relative">
                      {(() => {
                        const term = transferSkuSearchQuery.toLowerCase();
                        const suggestions = showTransferSkuSearchSuggestions && transferSkuSearchQuery.length >= 2 && inventoryData?.inventory
                          ? inventoryData.inventory
                              .filter(item => 
                                item.sku.toLowerCase().includes(term) ||
                                item.productTitle.toLowerCase().includes(term) ||
                                item.variantTitle.toLowerCase().includes(term)
                              )
                              .slice(0, 8)
                              .map(item => ({
                                sku: item.sku,
                                display: `${item.productTitle}${item.variantTitle !== 'Default Title' ? ` / ${item.variantTitle}` : ''}`
                              }))
                          : [];
                        
                        return (
                          <>
                            <input
                              type="text"
                              value={transferSkuSearchQuery}
                              onChange={(e) => {
                                const value = e.target.value;
                                setTransferSkuSearchQuery(value);
                                setShowTransferSkuSearchSuggestions(value.length >= 2);
                                setTransferSkuSearchSuggestionIndex(-1);
                                if (transferSkuSearchSelected && value.toUpperCase() !== transferSkuSearchSelected) {
                                  setTransferSkuSearchSelected('');
                                }
                              }}
                              onFocus={() => {
                                if (transferSkuSearchQuery.length >= 2) {
                                  setShowTransferSkuSearchSuggestions(true);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  // If a suggestion is highlighted, use that
                                  if (transferSkuSearchSuggestionIndex >= 0 && transferSkuSearchSuggestionIndex < suggestions.length) {
                                    setTransferSkuSearchQuery(suggestions[transferSkuSearchSuggestionIndex].sku);
                                    setTransferSkuSearchSelected(suggestions[transferSkuSearchSuggestionIndex].sku);
                                  } else if (transferSkuSearchQuery.trim()) {
                                    // Otherwise, use whatever is typed to filter
                                    setTransferSkuSearchSelected(transferSkuSearchQuery.trim());
                                  }
                                  setShowTransferSkuSearchSuggestions(false);
                                  setTransferSkuSearchSuggestionIndex(-1);
                                  return;
                                }
                                if (e.key === 'Escape') {
                                  setShowTransferSkuSearchSuggestions(false);
                                  setTransferSkuSearchSuggestionIndex(-1);
                                  return;
                                }
                                if (!showTransferSkuSearchSuggestions || suggestions.length === 0) {
                                  return;
                                }
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setTransferSkuSearchSuggestionIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setTransferSkuSearchSuggestionIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
                                }
                              }}
                              placeholder="Search by SKU, product, or tracking #..."
                              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-64"
                            />
                            {/* Show tracking number matches from transfers */}
                            {(() => {
                              const trackingTerm = transferSkuSearchQuery.toUpperCase();
                              const trackingMatches = showTransferSkuSearchSuggestions && transferSkuSearchQuery.length >= 2
                                ? transfers
                                    .filter(t => t.trackingNumber && (
                                      t.trackingNumber.toUpperCase().includes(trackingTerm) ||
                                      t.trackingNumber.toUpperCase().endsWith(trackingTerm)
                                    ))
                                    .slice(0, 5)
                                : [];
                              
                              if (trackingMatches.length > 0) {
                                return (
                                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-[320px] max-h-64 overflow-y-auto">
                                    <div className="px-3 py-1 text-xs text-gray-500 bg-gray-50 border-b">Tracking Numbers</div>
                                    {trackingMatches.map((t) => (
                                      <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => {
                                          setTransferSkuSearchQuery(t.trackingNumber || '');
                                          setTransferSkuSearchSelected(t.trackingNumber || '');
                                          setShowTransferSkuSearchSuggestions(false);
                                          setTransferSkuSearchSuggestionIndex(-1);
                                          setTransferFilterStatus('all');
                                        }}
                                        className="w-full px-3 py-2 text-left text-sm border-b border-gray-100 last:border-b-0 hover:bg-blue-50 hover:text-blue-700"
                                      >
                                        <span className="font-mono font-medium">{t.trackingNumber}</span>
                                        <span className="text-gray-500 ml-2 text-xs truncate block">
                                          {t.origin} → {t.destination} ({t.transferType})
                                        </span>
                                      </button>
                                    ))}
                                    {suggestions.length > 0 && <div className="px-3 py-1 text-xs text-gray-500 bg-gray-50 border-b border-t">SKUs</div>}
                                  </div>
                                );
                              }
                              return null;
                            })()}
                            {suggestions.length > 0 && !(() => {
                              const trackingTerm = transferSkuSearchQuery.toUpperCase();
                              return transfers.some(t => t.trackingNumber && (
                                t.trackingNumber.toUpperCase().includes(trackingTerm) ||
                                t.trackingNumber.toUpperCase().endsWith(trackingTerm)
                              ));
                            })() && (
                              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-[320px] max-h-64 overflow-y-auto">
                                {suggestions.map((s, idx) => (
                                  <button
                                    key={s.sku}
                                    type="button"
                                    onClick={() => {
                                      setTransferSkuSearchQuery(s.sku);
                                      setTransferSkuSearchSelected(s.sku);
                                      setShowTransferSkuSearchSuggestions(false);
                                      setTransferSkuSearchSuggestionIndex(-1);
                                      setTransferFilterStatus('all');
                                    }}
                                    className={`w-full px-3 py-2 text-left text-sm border-b border-gray-100 last:border-b-0 ${
                                      idx === transferSkuSearchSuggestionIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-blue-50 hover:text-blue-700'
                                    }`}
                                  >
                                    <span className="font-mono font-medium">{s.sku}</span>
                                    <span className="text-gray-500 ml-2 text-xs truncate block">{s.display}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {(transferSkuSearchSelected || transferDateFilter !== 'all' || transferFilterStatus !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setTransferSkuSearchQuery('');
                        setTransferSkuSearchSelected('');
                        setTransferFilterStatus('all');
                        setTransferDateFilter('all');
                      }}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Clear
                    </button>
                  )}
                  
                  {/* Action Button - hidden for read-only users */}
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => setShowNewTransferForm(true)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
                    >
                      + New Transfer
                    </button>
                  )}
                  </div>
                )}
              </div>
            </div>

            {/* Production Orders View */}
            {productionViewType === 'orders' && (
              <>
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
                
                // SKU search filter (only filter when a SKU is selected)
                if (skuSearchSelected) {
                  const hasMatchingSku = order.items.some(item => 
                    item.sku.toUpperCase() === skuSearchSelected.toUpperCase()
                  );
                  if (!hasMatchingSku) return false;
                }
                
                // Date filter (based on createdAt)
                if (poDateFilter !== 'all') {
                  const orderDate = new Date(order.createdAt);
                  const now = new Date();
                  let cutoffDate = new Date();
                  
                  switch (poDateFilter) {
                    case '1m': cutoffDate.setMonth(now.getMonth() - 1); break;
                    case '3m': cutoffDate.setMonth(now.getMonth() - 3); break;
                    case '6m': cutoffDate.setMonth(now.getMonth() - 6); break;
                    case '1y': cutoffDate.setFullYear(now.getFullYear() - 1); break;
                    case '2y': cutoffDate.setFullYear(now.getFullYear() - 2); break;
                  }
                  
                  if (orderDate < cutoffDate) return false;
                }
                
                return true;
              });

              // Calculate SKU-specific stats when a SKU is selected
              let skuStats: { totalOrdered: number; totalReceived: number; poCount: number } | null = null;
              if (skuSearchSelected) {
                const searchTerm = skuSearchSelected.toUpperCase();
                let totalOrdered = 0;
                let totalReceived = 0;
                const poSet = new Set<string>();
                
                filteredOrders.forEach(order => {
                  order.items.forEach(item => {
                    if (item.sku.toUpperCase() === searchTerm) {
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
                            <span className="ml-2 font-mono font-medium text-blue-900">{skuSearchSelected}</span>
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
                    <table className="min-w-full divide-y divide-gray-200 table-fixed">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="w-[9%] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">PO#</th>
                          <th className="w-[10%] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">PO Date</th>
                          <th className="w-[16%] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKUs</th>
                          <th className="w-[9%] px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Ordered</th>
                          <th className="w-[9%] px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Received</th>
                          <th className="w-[9%] px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase pr-6">Pending</th>
                          <th className="w-[12%] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase pl-6">Vendor</th>
                          <th className="w-[11%] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ETA</th>
                          <th className="w-[15%] px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
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
                              <td className="w-[9%] px-4 py-3 text-sm font-medium text-gray-900">
                                <span className="flex items-center gap-2">
                                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                  {order.id}
                                </span>
                              </td>
                              <td className="w-[10%] px-4 py-3 text-sm text-gray-600">
                                {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                              </td>
                              <td className="w-[16%] px-4 py-3 text-sm text-gray-600 font-mono" title={skuList}>{skuPreview}</td>
                              <td className="w-[9%] px-4 py-3 text-sm text-gray-600 text-center">{totalOrdered.toLocaleString()}</td>
                              <td className="w-[9%] px-4 py-3 text-sm text-green-600 text-center">{totalReceived.toLocaleString()}</td>
                              <td className={`w-[9%] px-4 py-3 text-sm text-center pr-6 ${totalOrdered - totalReceived > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
                                {(totalOrdered - totalReceived).toLocaleString()}
                              </td>
                              <td className="w-[12%] px-4 py-3 text-sm text-gray-600 pl-6">{order.vendor || '—'}</td>
                              <td className="w-[11%] px-4 py-3 text-sm text-gray-600">
                                {order.eta ? parseLocalDate(order.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                              </td>
                              <td className="w-[15%] px-4 py-3">
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
                                <td colSpan={9} className="bg-gray-50 px-4 py-4">
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
                                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">MCs</th>
                                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Ordered</th>
                                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Received</th>
                                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Pending</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-200">
                                            {order.items.map((item, index) => {
                                              const pending = item.quantity - (item.receivedQuantity || 0);
                                              const skuComment = skuComments[item.sku.toUpperCase()];
                                              const commentTooltip = skuComment 
                                                ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                                                : undefined;
                                              return (
                                                <tr key={index}>
                                                  <td className="px-4 py-2 text-sm text-gray-900 font-mono" title={commentTooltip}>
                                                    {item.sku}
                                                    {skuComment && <span className="ml-1">💬</span>}
                                                  </td>
                                                  <td className="px-4 py-2 text-sm text-gray-600 text-right">
                                                    {item.masterCartons ? item.masterCartons.toLocaleString() : '—'}
                                                  </td>
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
                                              <td className="px-4 py-2 text-sm font-medium text-gray-600 text-right">
                                                {order.items.reduce((sum, i) => sum + (i.masterCartons || 0), 0).toLocaleString()}
                                              </td>
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
                                                  <span className="font-medium text-gray-700">{formatActivityLogText(entry.action)}</span>
                                                  <span className="text-gray-400 whitespace-nowrap">
                                                    {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                  </span>
                                                </div>
                                                {entry.details && (
                                                  <div className="text-gray-500 mt-0.5">{formatActivityLogText(entry.details)}</div>
                                                )}
                                                <div className="text-gray-400 mt-0.5">by {entry.changedBy}</div>
                                              </div>
                                            ))}
                                          </div>
                                        </details>
                                      </div>
                                    )}
                                    {/* Actions - hidden for read-only users */}
                                    {!isReadOnly && (
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
                                                setEditOrderItems(order.items.map(i => ({ sku: i.sku, quantity: String(i.quantity), masterCartons: i.masterCartons ? String(i.masterCartons) : '' })));
                                                setEditOrderVendor(order.vendor || '');
                                                // Normalize ETA to YYYY-MM-DD format for date input
                                                setEditOrderEta(order.eta ? order.eta.split('T')[0] : '');
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
                                              setNewOrderItems(order.items.map(i => ({ sku: i.sku, quantity: String(i.quantity), masterCartons: i.masterCartons ? String(i.masterCartons) : '' })));
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
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                        {filteredOrders.length === 0 && (
                          <tr>
                            <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                              {skuSearchSelected || poDateFilter !== 'all'
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
                    {/* Note: PO# is auto-assigned */}
                    <p className="text-xs text-gray-500 italic">PO number will be auto-assigned (e.g., PO-001, PO-002, etc.)</p>
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
                                // Auto-calculate MCs if SKU is known
                                if (updated[index].sku && e.target.value) {
                                  const calculatedMc = calculateMC(updated[index].sku, parseInt(e.target.value) || 0);
                                  if (calculatedMc !== null) {
                                    updated[index].masterCartons = calculatedMc.toString();
                                  }
                                }
                                setNewOrderItems(updated);
                              }}
                              className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                            <input
                              type="number"
                              placeholder="MCs"
                              title="Master Cartons"
                              value={item.masterCartons}
                              onChange={(e) => {
                                const updated = [...newOrderItems];
                                updated[index].masterCartons = e.target.value;
                                setNewOrderItems(updated);
                              }}
                              className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm"
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
                        onClick={() => setNewOrderItems([...newOrderItems, { sku: '', quantity: '', masterCartons: '' }])}
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
                        setNewOrderItems([{ sku: '', quantity: '', masterCartons: '' }]);
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
                    <h3 className="text-lg font-semibold text-gray-900">Log Delivery - {selectedOrder.id}</h3>
                    <p className="text-sm text-gray-500 mt-1">Enter quantities received for each SKU</p>
                  </div>
                  <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                    {/* Receiving Warehouse Selection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Receiving Warehouse <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={deliveryLocation}
                        onChange={(e) => setDeliveryLocation(e.target.value as typeof deliveryLocation)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
                      >
                        <option value="China WH">China WH</option>
                        <option value="LA Office">LA Office</option>
                        <option value="DTLA WH">DTLA WH</option>
                        <option value="ShipBob">ShipBob</option>
                      </select>
                    </div>
                    
                    {/* Divider */}
                    <div className="border-t border-gray-200 pt-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Quantities Received</label>
                    </div>
                    
                    {/* SKU quantities */}
                    {deliveryItems.map((item, index) => {
                      const orderItem = selectedOrder.items.find(i => i.sku === item.sku);
                      const remaining = orderItem ? orderItem.quantity - (orderItem.receivedQuantity || 0) : 0;
                      return (
                        <div key={index} className="flex items-center gap-3">
                          <span className="text-sm font-medium text-gray-900 w-32 font-mono">{item.sku}</span>
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
                            placeholder="0"
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
                        setDeliveryLocation('China WH');
                      }}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={showOrderDeliveryConfirmation}
                      className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 active:bg-green-800"
                    >
                      Confirm Delivery
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Delivery Confirmation Modal */}
            {showDeliveryConfirm && selectedOrder && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Confirm Delivery to Shopify</h3>
                  </div>
                  <div className="px-6 py-4 space-y-4">
                    {/* Warning Banner */}
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="flex gap-2">
                        <span className="text-amber-600">⚠️</span>
                        <p className="text-sm text-amber-800">
                          Clicking the Confirm button below will update the inventory counts for <strong>{deliveryLocation}</strong> in Shopify.
                        </p>
                      </div>
                    </div>
                    
                    {/* Delivery Summary */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Delivery Summary</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">PO:</span>
                          <span className="font-medium">{selectedOrder.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Receiving Location:</span>
                          <span className="font-medium">{deliveryLocation}</span>
                        </div>
                        <div className="border-t border-gray-200 pt-2 mt-2">
                          <span className="text-gray-500 block mb-2">Items:</span>
                          {getValidDeliveries().map((item, idx) => (
                            <div key={idx} className="flex justify-between pl-4">
                              <span className="font-mono text-gray-700">{item.sku}</span>
                              <span className="font-medium">+{item.quantity}</span>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between font-medium">
                          <span>Total Units:</span>
                          <span>{getValidDeliveries().reduce((sum, item) => sum + item.quantity, 0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDeliveryConfirm(false)}
                      disabled={isLoggingDelivery}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={confirmDeliveryAndUpdateShopify}
                      disabled={isLoggingDelivery}
                      className={`px-4 py-2 rounded-md text-sm font-medium ${
                        isLoggingDelivery
                          ? 'bg-green-400 text-white cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                      }`}
                    >
                      {isLoggingDelivery ? (isUpdatingShopify ? 'Updating Shopify...' : 'Processing...') : 'Confirm & Update Shopify'}
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
                      {editOrderItems.map((item, index) => {
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
                                  const updated = [...editOrderItems];
                                  updated[index].sku = e.target.value.toUpperCase();
                                  setEditOrderItems(updated);
                                  setEditOrderSkuSuggestionIndex(index);
                                }}
                                onFocus={() => setEditOrderSkuSuggestionIndex(index)}
                                onBlur={() => setTimeout(() => setEditOrderSkuSuggestionIndex(null), 150)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                              />
                              {editOrderSkuSuggestionIndex === index && skuSuggestions.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                  {skuSuggestions.map((sku) => (
                                    <button
                                      key={sku}
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        const updated = [...editOrderItems];
                                        updated[index].sku = sku;
                                        setEditOrderItems(updated);
                                        setEditOrderSkuSuggestionIndex(null);
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
                                const updated = [...editOrderItems];
                                updated[index].quantity = e.target.value;
                                // Auto-calculate MCs if SKU is known
                                if (updated[index].sku && e.target.value) {
                                  const calculatedMc = calculateMC(updated[index].sku, parseInt(e.target.value) || 0);
                                  if (calculatedMc !== null) {
                                    updated[index].masterCartons = calculatedMc.toString();
                                  }
                                }
                                setEditOrderItems(updated);
                              }}
                              className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                            <input
                              type="number"
                              placeholder="MCs"
                              title="Master Cartons"
                              value={item.masterCartons}
                              onChange={(e) => {
                                const updated = [...editOrderItems];
                                updated[index].masterCartons = e.target.value;
                                setEditOrderItems(updated);
                              }}
                              className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm"
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
                        );
                      })}
                      <button
                        onClick={() => setEditOrderItems([...editOrderItems, { sku: '', quantity: '', masterCartons: '' }])}
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

              </>
            )}

            {/* Transfers View */}
            {productionViewType === 'transfers' && (
              <>
                {/* Transfers List */}
                {transfersLoading ? (
                  <div className="bg-white shadow rounded-lg p-8 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-2 text-gray-600">Loading transfers...</p>
                  </div>
                ) : (() => {
                  // Apply filters
                  const filteredTransfers = transfers.filter(transfer => {
                    // Status filter - 'active' includes draft, in_transit, and partial
                    if (transferFilterStatus === 'active' && ['delivered', 'cancelled'].includes(transfer.status)) return false;
                    if (transferFilterStatus === 'completed' && !['delivered', 'cancelled'].includes(transfer.status)) return false;
                    
                    // SKU, Product, or Tracking Number search filter
                    if (transferSkuSearchSelected) {
                      const searchTerm = transferSkuSearchSelected.toUpperCase();
                      
                      // Check SKU (partial match)
                      const hasMatchingSku = transfer.items.some(item => 
                        item.sku.toUpperCase().includes(searchTerm)
                      );
                      
                      // Check tracking number (partial match, including last digits)
                      const trackingMatch = transfer.trackingNumber && (
                        transfer.trackingNumber.toUpperCase().includes(searchTerm) ||
                        transfer.trackingNumber.toUpperCase().endsWith(searchTerm)
                      );
                      
                      // Check transfer ID
                      const idMatch = transfer.id.toUpperCase().includes(searchTerm);
                      
                      // Check origin/destination
                      const locationMatch = 
                        transfer.origin.toUpperCase().includes(searchTerm) ||
                        transfer.destination.toUpperCase().includes(searchTerm);
                      
                      if (!hasMatchingSku && !trackingMatch && !idMatch && !locationMatch) return false;
                    }
                    
                    // Date filter (based on createdAt)
                    if (transferDateFilter !== 'all') {
                      const transferDate = new Date(transfer.createdAt);
                      const now = new Date();
                      let cutoffDate = new Date();
                      
                      switch (transferDateFilter) {
                        case '1m': cutoffDate.setMonth(now.getMonth() - 1); break;
                        case '3m': cutoffDate.setMonth(now.getMonth() - 3); break;
                        case '6m': cutoffDate.setMonth(now.getMonth() - 6); break;
                        case '1y': cutoffDate.setFullYear(now.getFullYear() - 1); break;
                        case '2y': cutoffDate.setFullYear(now.getFullYear() - 2); break;
                      }
                      
                      if (transferDate < cutoffDate) return false;
                    }
                    
                    return true;
                  });

                  if (filteredTransfers.length === 0) {
                    return (
                      <div className="bg-white shadow rounded-lg p-8 text-center">
                        <p className="text-gray-500">No transfers found</p>
                        <button
                          onClick={() => setShowNewTransferForm(true)}
                          className="mt-4 text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          Create your first transfer
                        </button>
                      </div>
                    );
                  }

                  // Helper function to get tracking URL based on carrier
                  const getTrackingUrl = (carrier: string | undefined, trackingNumber: string | undefined): string | null => {
                    if (!trackingNumber) return null;
                    switch (carrier) {
                      case 'FedEx':
                        return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
                      case 'DHL':
                        return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${trackingNumber}`;
                      case 'UPS':
                        return `https://www.ups.com/track?tracknum=${trackingNumber}`;
                      default:
                        return null;
                    }
                  };

                  return (
                    <div className="bg-white shadow rounded-lg overflow-hidden">
                      <table className="min-w-full" style={{ tableLayout: 'fixed' }}>
                        <colgroup>
                          <col style={{ width: '70px' }} />
                          <col style={{ width: '100px' }} />
                          <col style={{ width: '100px' }} />
                          <col style={{ width: '85px' }} />
                          <col style={{ width: '95px' }} />
                          <col style={{ width: '150px' }} />
                          <col style={{ width: '100px' }} />
                          <col style={{ width: '90px' }} />
                        </colgroup>
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Origin</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Destination</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shipment</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Carrier / Tracking</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Est. Arrival</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {filteredTransfers.map(transfer => {
                            const isExpanded = selectedTransfer?.id === transfer.id;
                            const totalItems = transfer.items.reduce((sum, i) => sum + i.quantity, 0);
                            const skuPreview = transfer.items.map(i => i.sku).join(', ');
                            const displaySkus = skuPreview.length > 20 ? skuPreview.substring(0, 20) + '...' : skuPreview;
                            const trackingUrl = getTrackingUrl(transfer.carrier, transfer.trackingNumber);
                            
                            return (
                              <Fragment key={transfer.id}>
                                <tr 
                                  className={`cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                  onClick={() => setSelectedTransfer(isExpanded ? null : transfer)}
                                >
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                    <span className="flex items-center gap-2">
                                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                      </svg>
                                      {transfer.id}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-600">{transfer.origin}</td>
                                  <td className="px-4 py-3 text-sm text-gray-600">{transfer.destination}</td>
                                  <td className="px-4 py-3 text-sm text-gray-500">{transfer.transferType || '—'}</td>
                                  <td className="px-4 py-3 text-sm text-gray-500" title={skuPreview}>
                                    {transfer.items.length} SKU{transfer.items.length !== 1 ? 's' : ''} ({totalItems.toLocaleString()})
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-500">
                                    {transfer.carrier ? (
                                      <span>
                                        {transfer.carrier}
                                        {transfer.trackingNumber && (
                                          <>
                                            {' / '}
                                            {trackingUrl ? (
                                              <a
                                                href={trackingUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-blue-600 hover:text-blue-800 hover:underline"
                                              >
                                                {transfer.trackingNumber}
                                              </a>
                                            ) : (
                                              <span>{transfer.trackingNumber}</span>
                                            )}
                                          </>
                                        )}
                                      </span>
                                    ) : '—'}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-500">
                                    {transfer.eta ? parseLocalDate(transfer.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                      transfer.status === 'draft' ? 'bg-gray-100 text-gray-800' :
                                      transfer.status === 'in_transit' ? 'bg-blue-100 text-blue-800' :
                                      transfer.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                                      transfer.status === 'delivered' ? 'bg-green-100 text-green-800' :
                                      transfer.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}>
                                      {transfer.status === 'in_transit' ? 'In Transit' : 
                                       transfer.status === 'partial' ? 'Partial Delivery' :
                                       transfer.status.charAt(0).toUpperCase() + transfer.status.slice(1)}
                                    </span>
                                  </td>
                                </tr>
                                {/* Expanded Details Row */}
                                {isExpanded && (
                                  <tr>
                                    <td colSpan={7} className="bg-gray-50 px-4 py-4">
                                      <div className="space-y-4">
                                        {/* Meta info */}
                                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                                          <div>
                                            <span className="text-gray-500">Created by:</span>
                                            <span className="ml-2 text-gray-900">{transfer.createdBy}</span>
                                          </div>
                                          <div>
                                            <span className="text-gray-500">Carrier:</span>
                                            <span className="ml-2 text-gray-900">{transfer.carrier || '—'}</span>
                                          </div>
                                          <div>
                                            <span className="text-gray-500">Created:</span>
                                            <span className="ml-2 text-gray-900">
                                              {new Date(transfer.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-gray-500">Est. Arrival:</span>
                                            <span className="ml-2 text-gray-900">
                                              {transfer.eta ? parseLocalDate(transfer.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-gray-500">Delivered:</span>
                                            <span className="ml-2 text-gray-900">
                                              {transfer.deliveredAt ? new Date(transfer.deliveredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                            </span>
                                          </div>
                                        </div>
                                        {/* Tracking Number Row */}
                                        {transfer.trackingNumber && (
                                          <div className="text-sm">
                                            <span className="text-gray-500">Tracking:</span>
                                            <span className="ml-2">
                                              {trackingUrl ? (
                                                <a
                                                  href={trackingUrl}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="text-blue-600 hover:text-blue-800 hover:underline"
                                                >
                                                  {transfer.trackingNumber}
                                                </a>
                                              ) : (
                                                <span className="text-gray-900">{transfer.trackingNumber}</span>
                                              )}
                                            </span>
                                          </div>
                                        )}
                                        {/* Items Table */}
                                        <div>
                                          <h4 className="text-sm font-medium text-gray-700 mb-2">Items ({transfer.items.length})</h4>
                                          <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
                                            <table className="min-w-full divide-y divide-gray-200">
                                              <thead className="bg-gray-100">
                                                <tr>
                                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">MCs</th>
                                                  {transfer.transferType === 'Sea' && transfer.items.some(i => i.pallet) && (
                                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pallet</th>
                                                  )}
                                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total Qty</th>
                                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Delivered</th>
                                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Pending</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-gray-200">
                                                {(() => {
                                                  // Sort items by pallet number if available
                                                  const hasPallets = transfer.transferType === 'Sea' && transfer.items.some(i => i.pallet);
                                                  const sortedItems = hasPallets
                                                    ? [...transfer.items].sort((a, b) => {
                                                        const palletA = parseInt(a.pallet?.replace('Pallet ', '') || '999');
                                                        const palletB = parseInt(b.pallet?.replace('Pallet ', '') || '999');
                                                        return palletA - palletB;
                                                      })
                                                    : transfer.items;
                                                  
                                                  return sortedItems.map((item, idx) => {
                                                    const delivered = item.receivedQuantity || 0;
                                                    const pending = item.quantity - delivered;
                                                    const skuComment = skuComments[item.sku.toUpperCase()];
                                                    const commentTooltip = skuComment 
                                                      ? `${skuComment.comment}\n\n— ${skuComment.updatedBy}, ${new Date(skuComment.updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
                                                      : undefined;
                                                    return (
                                                      <tr key={idx}>
                                                        <td className="px-4 py-2 text-sm text-gray-900 font-mono" title={commentTooltip}>
                                                          {item.sku}
                                                          {skuComment && <span className="ml-1">💬</span>}
                                                        </td>
                                                        <td className="px-4 py-2 text-sm text-gray-600 text-right">
                                                          {item.masterCartons ? item.masterCartons.toLocaleString() : '—'}
                                                        </td>
                                                        {hasPallets && (
                                                          <td className="px-4 py-2 text-sm text-gray-900">{item.pallet || '—'}</td>
                                                        )}
                                                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{item.quantity.toLocaleString()}</td>
                                                        <td className="px-4 py-2 text-sm text-green-600 text-right">{delivered.toLocaleString()}</td>
                                                        <td className={`px-4 py-2 text-sm text-right ${pending > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
                                                          {pending.toLocaleString()}
                                                        </td>
                                                      </tr>
                                                    );
                                                  });
                                                })()}
                                                <tr className="bg-gray-100">
                                                  <td className="px-4 py-2 text-sm font-medium text-gray-900">Total</td>
                                                  <td className="px-4 py-2 text-sm font-medium text-gray-600 text-right">
                                                    {transfer.items.reduce((sum, i) => sum + (i.masterCartons || 0), 0).toLocaleString()}
                                                  </td>
                                                  {transfer.transferType === 'Sea' && transfer.items.some(i => i.pallet) && (
                                                    <td className="px-4 py-2 text-sm font-medium text-gray-900"></td>
                                                  )}
                                                  <td className="px-4 py-2 text-sm font-medium text-gray-900 text-right">
                                                    {transfer.items.reduce((sum, i) => sum + i.quantity, 0).toLocaleString()}
                                                  </td>
                                                  <td className="px-4 py-2 text-sm font-medium text-green-600 text-right">
                                                    {transfer.items.reduce((sum, i) => sum + (i.receivedQuantity || 0), 0).toLocaleString()}
                                                  </td>
                                                  <td className="px-4 py-2 text-sm font-medium text-orange-600 text-right">
                                                    {transfer.items.reduce((sum, i) => sum + (i.quantity - (i.receivedQuantity || 0)), 0).toLocaleString()}
                                                  </td>
                                                </tr>
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                        {/* Notes */}
                                        {transfer.notes && (
                                          <div>
                                            <h4 className="text-sm font-medium text-gray-700 mb-2">Notes</h4>
                                            <p className="text-sm text-gray-600 bg-white p-3 rounded-md border border-gray-200">{transfer.notes}</p>
                                          </div>
                                        )}
                                        {/* Activity Log */}
                                        {transfer.activityLog && transfer.activityLog.length > 0 && (
                                          <div>
                                            <details className="group">
                                              <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700 flex items-center gap-1">
                                                <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                                Activity Log ({transfer.activityLog.length})
                                              </summary>
                                              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                                                {[...transfer.activityLog].reverse().map((entry, idx) => (
                                                  <div key={idx} className="text-xs text-gray-500 bg-white p-2 rounded border border-gray-100">
                                                    <div className="flex justify-between items-start gap-2">
                                                      <span className="font-medium text-gray-700">{formatActivityLogText(entry.action)}</span>
                                                      <span className="text-gray-400 whitespace-nowrap">
                                                        {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                      </span>
                                                    </div>
                                                    {entry.details && (
                                                      <div className="text-gray-500 mt-0.5">{formatActivityLogText(entry.details)}</div>
                                                    )}
                                                    <div className="text-gray-400 mt-0.5">by {entry.changedBy}</div>
                                                  </div>
                                                ))}
                                              </div>
                                            </details>
                                          </div>
                                        )}
                                        {/* Actions - hidden for read-only users */}
                                        {!isReadOnly && (
                                          <div className="flex gap-2 pt-2">
                                            {!['delivered', 'cancelled'].includes(transfer.status) ? (
                                              <>
                                                {/* Draft status: show Mark In Transit green button */}
                                                {transfer.status === 'draft' && (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => { 
                                                      e.stopPropagation(); 
                                                      showMarkInTransitConfirmation(transfer);
                                                    }}
                                                    disabled={isMarkingInTransit}
                                                    className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                                                      isMarkingInTransit
                                                        ? 'bg-green-400 text-white cursor-not-allowed'
                                                        : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                                                    }`}
                                                  >
                                                    Mark In Transit
                                                  </button>
                                                )}
                                                {/* In Transit or Partial status: show Log Delivery green button */}
                                                {['in_transit', 'partial'].includes(transfer.status) && (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => { 
                                                      e.stopPropagation();
                                                      setSelectedTransfer(transfer);
                                                      setTransferDeliveryItems(
                                                        transfer.items.map(item => ({
                                                          sku: item.sku,
                                                          quantity: '',
                                                        }))
                                                      );
                                                      setShowTransferDeliveryForm(true);
                                                    }}
                                                    className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 active:bg-green-800"
                                                  >
                                                    Log Delivery
                                                  </button>
                                                )}
                                                <button
                                                  type="button"
                                                  onClick={(e) => { 
                                                    e.stopPropagation(); 
                                                    setEditTransferOrigin(transfer.origin);
                                                    setEditTransferDestination(transfer.destination);
                                                    setEditTransferType(transfer.transferType || '');
                                                    setEditTransferItems(transfer.items.map(i => ({ 
                                                      sku: i.sku, 
                                                      quantity: String(i.quantity),
                                                      pallet: i.pallet || 'Pallet 1',
                                                      masterCartons: i.masterCartons ? String(i.masterCartons) : ''
                                                    })));
                                                    setEditTransferCarrier(transfer.carrier || '');
                                                    setEditTransferTracking(transfer.trackingNumber || '');
                                                    // Normalize ETA to YYYY-MM-DD format for date input
                                                    setEditTransferEta(transfer.eta ? transfer.eta.split('T')[0] : '');
                                                    setEditTransferNotes(transfer.notes || '');
                                                    setShowEditTransferForm(true);
                                                  }}
                                                  className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
                                                >
                                                  Edit
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={(e) => { e.stopPropagation(); setShowCancelTransferConfirm(true); }}
                                                  className="px-3 py-1.5 text-red-600 hover:bg-red-100 active:bg-red-200 rounded-md text-sm font-medium"
                                                >
                                                  Cancel Transfer
                                                </button>
                                              </>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setNewTransferOrigin(transfer.origin);
                                                  setNewTransferDestination(transfer.destination);
                                                  setNewTransferItems(transfer.items.map(i => ({ 
                                                    sku: i.sku, 
                                                    quantity: String(i.quantity),
                                                    pallet: i.pallet || 'Pallet 1',
                                                    masterCartons: i.masterCartons ? String(i.masterCartons) : ''
                                                  })));
                                                  setNewTransferCarrier(transfer.carrier || '');
                                                  setNewTransferTracking('');
                                                  setNewTransferEta('');
                                                  setNewTransferNotes(transfer.notes || '');
                                                  setSelectedTransfer(null);
                                                  setShowNewTransferForm(true);
                                                }}
                                                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 active:bg-gray-300"
                                              >
                                                Duplicate Transfer
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* New Transfer Modal */}
                {showNewTransferForm && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Create New Transfer</h3>
                      </div>
                      <div className="px-6 py-4 space-y-4">
                        {/* Origin, Destination & Shipment Type */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Origin <span className="text-red-500">*</span></label>
                            <select
                              value={newTransferOrigin}
                              onChange={(e) => setNewTransferOrigin(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            >
                              <option value="">Select origin...</option>
                              {transferLocations.map(loc => (
                                <option key={loc} value={loc} disabled={loc === newTransferDestination}>{loc}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Destination <span className="text-red-500">*</span></label>
                            <select
                              value={newTransferDestination}
                              onChange={(e) => {
                                const dest = e.target.value;
                                setNewTransferDestination(dest);
                                // Auto-set Immediate for Distributor transfers
                                if (dest === 'Distributor') {
                                  setNewTransferType('Immediate');
                                }
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            >
                              <option value="">Select destination...</option>
                              {transferLocations.filter(loc => loc !== newTransferOrigin).map(loc => (
                                <option key={loc} value={loc}>{loc}</option>
                              ))}
                              <option value="Distributor">Distributor</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Shipment Type <span className="text-red-500">*</span></label>
                            <select
                              value={newTransferType}
                              onChange={(e) => setNewTransferType(e.target.value as TransferType)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                              disabled={newTransferDestination === 'Distributor'}
                            >
                              <option value="">Select shipment type...</option>
                              <option value="Air Express">Air Express</option>
                              <option value="Air Slow">Air Slow</option>
                              <option value="Sea">Sea</option>
                              <option value="Immediate">Immediate</option>
                            </select>
                          </div>
                        </div>
                        
                        {/* Items */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Items <span className="text-red-500">*</span></label>
                          {newTransferItems.map((item, index) => {
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
                                      const updated = [...newTransferItems];
                                      updated[index].sku = e.target.value.toUpperCase();
                                      setNewTransferItems(updated);
                                      setTransferSkuSuggestionIndex(index);
                                    }}
                                    onFocus={() => setTransferSkuSuggestionIndex(index)}
                                    onBlur={() => setTimeout(() => setTransferSkuSuggestionIndex(null), 150)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                  />
                                  {transferSkuSuggestionIndex === index && skuSuggestions.length > 0 && (
                                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                      {skuSuggestions.map((sku) => (
                                        <button
                                          key={sku}
                                          type="button"
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            const updated = [...newTransferItems];
                                            updated[index].sku = sku;
                                            setNewTransferItems(updated);
                                            setTransferSkuSuggestionIndex(null);
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
                                    const updated = [...newTransferItems];
                                    updated[index].quantity = e.target.value;
                                    // Auto-calculate MCs if SKU is known
                                    if (updated[index].sku && e.target.value) {
                                      const calculatedMc = calculateMC(updated[index].sku, parseInt(e.target.value) || 0);
                                      if (calculatedMc !== null) {
                                        updated[index].masterCartons = calculatedMc.toString();
                                      }
                                    }
                                    setNewTransferItems(updated);
                                  }}
                                  className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                                <input
                                  type="number"
                                  placeholder="MCs"
                                  title="Master Cartons"
                                  value={item.masterCartons}
                                  onChange={(e) => {
                                    const updated = [...newTransferItems];
                                    updated[index].masterCartons = e.target.value;
                                    setNewTransferItems(updated);
                                  }}
                                  className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                                {newTransferType === 'Sea' && (
                                  <select
                                    value={item.pallet || 'Pallet 1'}
                                    onChange={(e) => {
                                      const updated = [...newTransferItems];
                                      updated[index].pallet = e.target.value;
                                      setNewTransferItems(updated);
                                    }}
                                    className="w-28 px-2 py-2 border border-gray-300 rounded-md text-sm"
                                  >
                                    {Array.from({ length: 20 }, (_, i) => (
                                      <option key={i + 1} value={`Pallet ${i + 1}`}>Pallet {i + 1}</option>
                                    ))}
                                  </select>
                                )}
                                {newTransferItems.length > 1 && (
                                  <button
                                    onClick={() => setNewTransferItems(newTransferItems.filter((_, i) => i !== index))}
                                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            );
                          })}
                          <button
                            onClick={() => {
                              const lastPallet = newTransferItems[newTransferItems.length - 1]?.pallet || 'Pallet 1';
                              setNewTransferItems([...newTransferItems, { sku: '', quantity: '', pallet: lastPallet, masterCartons: '' }]);
                            }}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            + Add another SKU
                          </button>
                        </div>
                        
                        {/* Carrier, Tracking & Est. Delivery */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Carrier (optional)</label>
                            <select
                              value={newTransferCarrier}
                              onChange={(e) => setNewTransferCarrier(e.target.value as CarrierType)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            >
                              <option value="">Select carrier...</option>
                              <option value="FedEx">FedEx</option>
                              <option value="DHL">DHL</option>
                              <option value="UPS">UPS</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Tracking # (optional)</label>
                            <input
                              type="text"
                              value={newTransferTracking}
                              onChange={(e) => setNewTransferTracking(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                              placeholder="e.g. 1Z999AA1012345"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Est. Delivery (optional)</label>
                            <input
                              type="date"
                              value={newTransferEta}
                              onChange={(e) => setNewTransferEta(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                          </div>
                        </div>
                        
                        {/* Notes */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
                          <textarea
                            value={newTransferNotes}
                            onChange={(e) => setNewTransferNotes(e.target.value)}
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
                            setShowNewTransferForm(false);
                            setNewTransferOrigin('');
                            setNewTransferDestination('');
                            setNewTransferItems([{ sku: '', quantity: '', pallet: 'Pallet 1', masterCartons: '' }]);
                            setNewTransferCarrier('');
                            setNewTransferTracking('');
                            setNewTransferEta('');
                            setNewTransferNotes('');
                          }}
                          className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={createTransfer}
                          disabled={isCreatingTransfer}
                          className={`px-4 py-2 rounded-md text-sm font-medium ${
                            isCreatingTransfer
                              ? 'bg-blue-400 text-white cursor-not-allowed' 
                              : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
                          }`}
                        >
                          {isCreatingTransfer ? 'Creating...' : (newTransferType === 'Immediate' ? 'Transfer Now' : 'Create Transfer')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Edit Transfer Modal */}
                {showEditTransferForm && selectedTransfer && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Edit Transfer {selectedTransfer.id}</h3>
                      </div>
                      <div className="px-6 py-4 space-y-4">
                        {/* Origin, Destination & Shipment Type */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Origin <span className="text-red-500">*</span></label>
                            <select
                              value={editTransferOrigin}
                              onChange={(e) => setEditTransferOrigin(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            >
                              {transferLocations.map(loc => (
                                <option key={loc} value={loc} disabled={loc === editTransferDestination}>{loc}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Destination <span className="text-red-500">*</span></label>
                            <select
                              value={editTransferDestination}
                              onChange={(e) => {
                                const dest = e.target.value;
                                setEditTransferDestination(dest);
                                // Auto-set Immediate for Distributor transfers
                                if (dest === 'Distributor') {
                                  setEditTransferType('Immediate');
                                }
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            >
                              {transferLocations.filter(loc => loc !== editTransferOrigin).map(loc => (
                                <option key={loc} value={loc}>{loc}</option>
                              ))}
                              <option value="Distributor">Distributor</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Shipment Type <span className="text-red-500">*</span></label>
                            <select
                              value={editTransferType}
                              onChange={(e) => setEditTransferType(e.target.value as TransferType)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                              disabled={editTransferDestination === 'Distributor'}
                            >
                              <option value="">Select shipment type...</option>
                              <option value="Air Express">Air Express</option>
                              <option value="Air Slow">Air Slow</option>
                              <option value="Sea">Sea</option>
                              <option value="Immediate">Immediate</option>
                            </select>
                          </div>
                        </div>
                        
                        {/* Items */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Items <span className="text-red-500">*</span></label>
                          {editTransferItems.map((item, index) => {
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
                                      const updated = [...editTransferItems];
                                      updated[index].sku = e.target.value.toUpperCase();
                                      setEditTransferItems(updated);
                                      setEditTransferSkuSuggestionIndex(index);
                                    }}
                                    onFocus={() => setEditTransferSkuSuggestionIndex(index)}
                                    onBlur={() => setTimeout(() => setEditTransferSkuSuggestionIndex(null), 150)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                  />
                                  {editTransferSkuSuggestionIndex === index && skuSuggestions.length > 0 && (
                                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                      {skuSuggestions.map((sku) => (
                                        <button
                                          key={sku}
                                          type="button"
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            const updated = [...editTransferItems];
                                            updated[index].sku = sku;
                                            setEditTransferItems(updated);
                                            setEditTransferSkuSuggestionIndex(null);
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
                                    const updated = [...editTransferItems];
                                    updated[index].quantity = e.target.value;
                                    // Auto-calculate MCs if SKU is known
                                    if (updated[index].sku && e.target.value) {
                                      const calculatedMc = calculateMC(updated[index].sku, parseInt(e.target.value) || 0);
                                      if (calculatedMc !== null) {
                                        updated[index].masterCartons = calculatedMc.toString();
                                      }
                                    }
                                    setEditTransferItems(updated);
                                  }}
                                  className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                                <input
                                  type="number"
                                  placeholder="MCs"
                                  title="Master Cartons"
                                  value={item.masterCartons}
                                  onChange={(e) => {
                                    const updated = [...editTransferItems];
                                    updated[index].masterCartons = e.target.value;
                                    setEditTransferItems(updated);
                                  }}
                                  className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                                {editTransferType === 'Sea' && (
                                  <select
                                    value={item.pallet || 'Pallet 1'}
                                    onChange={(e) => {
                                      const updated = [...editTransferItems];
                                      updated[index].pallet = e.target.value;
                                      setEditTransferItems(updated);
                                    }}
                                    className="w-28 px-2 py-2 border border-gray-300 rounded-md text-sm"
                                  >
                                    {Array.from({ length: 20 }, (_, i) => (
                                      <option key={i + 1} value={`Pallet ${i + 1}`}>Pallet {i + 1}</option>
                                    ))}
                                  </select>
                                )}
                                {editTransferItems.length > 1 && (
                                  <button
                                    onClick={() => setEditTransferItems(editTransferItems.filter((_, i) => i !== index))}
                                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            );
                          })}
                          <button
                            onClick={() => {
                              const lastPallet = editTransferItems[editTransferItems.length - 1]?.pallet || 'Pallet 1';
                              setEditTransferItems([...editTransferItems, { sku: '', quantity: '', pallet: lastPallet, masterCartons: '' }]);
                            }}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            + Add another SKU
                          </button>
                        </div>
                        
                        {/* Carrier, Tracking & Est. Delivery */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Carrier (optional)</label>
                            <select
                              value={editTransferCarrier}
                              onChange={(e) => setEditTransferCarrier(e.target.value as CarrierType)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            >
                              <option value="">Select carrier...</option>
                              <option value="FedEx">FedEx</option>
                              <option value="DHL">DHL</option>
                              <option value="UPS">UPS</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Tracking # (optional)</label>
                            <input
                              type="text"
                              value={editTransferTracking}
                              onChange={(e) => setEditTransferTracking(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                              placeholder="e.g. 1Z999AA1012345"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Est. Delivery (optional)</label>
                            <input
                              type="date"
                              value={editTransferEta}
                              onChange={(e) => setEditTransferEta(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                          </div>
                        </div>
                        
                        {/* Notes */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
                          <textarea
                            value={editTransferNotes}
                            onChange={(e) => setEditTransferNotes(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            placeholder="Additional notes..."
                          />
                        </div>
                      </div>
                      <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setShowEditTransferForm(false)}
                          className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={saveTransferEdits}
                          disabled={isSavingTransfer}
                          className={`px-4 py-2 rounded-md text-sm font-medium ${
                            isSavingTransfer 
                              ? 'bg-blue-400 text-white cursor-not-allowed' 
                              : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
                          }`}
                        >
                          {isSavingTransfer ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Cancel Transfer Confirmation Modal */}
                {showCancelTransferConfirm && selectedTransfer && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Cancel Transfer?</h3>
                      </div>
                      <div className="px-6 py-4">
                        <p className="text-gray-600">
                          Are you sure you want to cancel <span className="font-medium">{selectedTransfer.id}</span>? 
                          This action cannot be undone.
                        </p>
                      </div>
                      <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setShowCancelTransferConfirm(false)}
                          className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                        >
                          Keep Transfer
                        </button>
                        <button
                          type="button"
                          onClick={cancelTransfer}
                          disabled={isCancellingTransfer}
                          className={`px-4 py-2 rounded-md text-sm font-medium ${
                            isCancellingTransfer
                              ? 'bg-red-400 text-white cursor-not-allowed'
                              : 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800'
                          }`}
                        >
                          {isCancellingTransfer ? 'Cancelling...' : 'Yes, Cancel Transfer'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Mark In Transit / Immediate Transfer Confirmation Modal */}
                {showMarkInTransitConfirm && transferToMarkInTransit && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {transferToMarkInTransit.transferType === 'Immediate' 
                            ? 'Confirm Immediate Transfer' 
                            : 'Confirm Mark In Transit'}
                        </h3>
                      </div>
                      <div className="px-6 py-4 space-y-4">
                        {transferToMarkInTransit.transferType === 'Immediate' ? (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-sm text-blue-800 font-medium">⚡ Immediate Transfer</p>
                            <p className="text-sm text-blue-700 mt-1">
                              • Stock will be subtracted from <strong>{transferToMarkInTransit.origin}</strong>
                              {transferToMarkInTransit.destination === 'ShipBob' && (
                                <><br/>• ShipBob manages its own inventory</>
                              )}
                              {transferToMarkInTransit.destination !== 'ShipBob' && transferToMarkInTransit.destination !== 'Distributor' && (
                                <><br/>• Stock will be added to <strong>{transferToMarkInTransit.destination}</strong></>
                              )}
                            </p>
                          </div>
                        ) : (
                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                            <p className="text-sm text-yellow-800 font-medium">⚠️ Mark In Transit</p>
                            <p className="text-sm text-yellow-700 mt-1">
                              Stock will be subtracted from <strong>{transferToMarkInTransit.origin}</strong> and put In Transit.
                            </p>
                          </div>
                        )}
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Transfer ID:</span>
                            <span className="font-medium text-gray-900">{transferToMarkInTransit.id}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Origin:</span>
                            <span className="font-medium text-gray-900">{transferToMarkInTransit.origin}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Destination:</span>
                            <span className="font-medium text-gray-900">{transferToMarkInTransit.destination}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Shipment Type:</span>
                            <span className="font-medium text-gray-900">{transferToMarkInTransit.transferType || '—'}</span>
                          </div>
                        </div>

                        <div className="border-t pt-3">
                          <p className="text-sm font-medium text-gray-700 mb-2">
                            {transferToMarkInTransit.transferType === 'Immediate' ? 'Items to be transferred:' : 'Items to be shipped:'}
                          </p>
                          <div className="bg-gray-50 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                            {transferToMarkInTransit.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-sm">
                                <span className="font-mono text-gray-600">{item.sku}</span>
                                <span className="text-gray-900">{item.quantity.toLocaleString()} units</span>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Total: {transferToMarkInTransit.items.reduce((sum, i) => sum + i.quantity, 0).toLocaleString()} units
                          </p>
                        </div>
                      </div>
                      <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowMarkInTransitConfirm(false);
                            setTransferToMarkInTransit(null);
                          }}
                          className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={confirmMarkInTransit}
                          disabled={isMarkingInTransit}
                          className={`px-4 py-2 rounded-md text-sm font-medium ${
                            isMarkingInTransit
                              ? 'bg-green-400 text-white cursor-not-allowed'
                              : transferToMarkInTransit.transferType === 'Immediate'
                                ? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
                                : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                          }`}
                        >
                          {isMarkingInTransit 
                            ? 'Updating Shopify...' 
                            : transferToMarkInTransit.transferType === 'Immediate'
                              ? 'Confirm Immediate Transfer'
                              : 'Confirm & Update Shopify'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Immediate Transfer Confirmation Modal (from New Transfer form) */}
                {showImmediateTransferConfirm && pendingImmediateTransfer && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Confirm Immediate Transfer</h3>
                      </div>
                      <div className="px-6 py-4 space-y-4">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <p className="text-sm text-blue-800 font-medium">⚡ Immediate Transfer</p>
                          <p className="text-sm text-blue-700 mt-1">
                            • Stock will be subtracted from <strong>{pendingImmediateTransfer.origin}</strong>
                            {pendingImmediateTransfer.destination === 'ShipBob' && (
                              <><br/>• ShipBob manages its own inventory</>
                            )}
                            {pendingImmediateTransfer.destination !== 'ShipBob' && pendingImmediateTransfer.destination !== 'Distributor' && (
                              <><br/>• Stock will be added to <strong>{pendingImmediateTransfer.destination}</strong></>
                            )}
                          </p>
                        </div>

                        <div className="border-t pt-3">
                          <p className="text-sm font-medium text-gray-700 mb-2">Items to be transferred:</p>
                          <div className="bg-gray-50 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                            {pendingImmediateTransfer.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-sm">
                                <span className="font-mono text-gray-600">{item.sku}</span>
                                <span className="text-gray-900">{item.quantity.toLocaleString()} units</span>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Total: {pendingImmediateTransfer.items.reduce((sum, i) => sum + i.quantity, 0).toLocaleString()} units
                          </p>
                        </div>
                      </div>
                      <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowImmediateTransferConfirm(false);
                            setPendingImmediateTransfer(null);
                          }}
                          className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={confirmImmediateTransfer}
                          disabled={isExecutingImmediateTransfer}
                          className={`px-4 py-2 rounded-md text-sm font-medium ${
                            isExecutingImmediateTransfer
                              ? 'bg-blue-400 text-white cursor-not-allowed'
                              : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
                          }`}
                        >
                          {isExecutingImmediateTransfer ? 'Transferring...' : 'Confirm Transfer'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Log Delivery Confirmation Modal */}
                {showLogDeliveryConfirm && selectedTransfer && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Confirm Delivery</h3>
                      </div>
                      <div className="px-6 py-4 space-y-4">
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                          <p className="text-sm text-yellow-800 font-medium">⚠️ Confirm Delivery</p>
                          <p className="text-sm text-yellow-700 mt-1">
                            {selectedTransfer.destination === 'ShipBob' 
                              ? 'ShipBob manages its own inventory'
                              : <>Stock will be added to <strong>{selectedTransfer.destination}</strong></>
                            }
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Transfer ID:</span>
                            <span className="font-medium text-gray-900">{selectedTransfer.id}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Destination:</span>
                            <span className="font-medium text-gray-900">{selectedTransfer.destination}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Shipment Type:</span>
                            <span className="font-medium text-gray-900">{selectedTransfer.transferType}</span>
                          </div>
                        </div>

                        <div className="border-t pt-3">
                          <p className="text-sm font-medium text-gray-700 mb-2">Items being received:</p>
                          <div className="bg-gray-50 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                            {transferDeliveryItems
                              .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
                              .map((item, idx) => (
                                <div key={idx} className="flex justify-between text-sm">
                                  <span className="font-mono text-gray-600">{item.sku}</span>
                                  <span className="text-gray-900">{parseInt(item.quantity).toLocaleString()} units</span>
                                </div>
                              ))}
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Total: {transferDeliveryItems
                              .filter(item => item.sku.trim() && parseInt(item.quantity) > 0)
                              .reduce((sum, i) => sum + parseInt(i.quantity), 0).toLocaleString()} units
                          </p>
                        </div>
                      </div>
                      <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowLogDeliveryConfirm(false);
                            setShowTransferDeliveryForm(true);
                          }}
                          className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={confirmLogDelivery}
                          disabled={isLoggingDelivery}
                          className={`px-4 py-2 rounded-md text-sm font-medium ${
                            isLoggingDelivery
                              ? 'bg-green-400 text-white cursor-not-allowed'
                              : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                          }`}
                        >
                          {isLoggingDelivery ? 'Updating...' : 'Confirm Delivery'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Transfer Delivery Modal */}
                {showTransferDeliveryForm && selectedTransfer && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Log Delivery - {selectedTransfer.id}</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {selectedTransfer.origin} → {selectedTransfer.destination}
                        </p>
                      </div>
                      <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
                        {transferDeliveryItems.map((item, index) => {
                          const transferItem = selectedTransfer.items.find(i => i.sku === item.sku);
                          const totalQty = transferItem?.quantity || 0;
                          const alreadyReceived = transferItem?.receivedQuantity || 0;
                          const remaining = totalQty - alreadyReceived;
                          return (
                            <div key={index} className="flex items-center gap-3">
                              <span className="text-sm font-medium text-gray-900 w-32 font-mono">{item.sku}</span>
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={(e) => {
                                  const updated = [...transferDeliveryItems];
                                  updated[index].quantity = e.target.value;
                                  setTransferDeliveryItems(updated);
                                }}
                                min="0"
                                max={remaining}
                                placeholder="0"
                                className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                              />
                              <span className="text-sm text-gray-500">of {remaining} remaining</span>
                              {alreadyReceived > 0 && (
                                <span className="text-xs text-green-600">({alreadyReceived} already received)</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowTransferDeliveryForm(false);
                            setTransferDeliveryItems([]);
                          }}
                          className="px-4 py-2 text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-md text-sm font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => showDeliveryConfirmation()}
                          className="px-4 py-2 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 active:bg-green-800"
                        >
                          Continue
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            
            {/* Toast Notification for Production/Transfers */}
            {prodNotification && (
              <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
                <div className={`flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border ${
                  prodNotification.type === 'success' 
                    ? 'bg-green-50 border-green-200' 
                    : prodNotification.type === 'warning'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                    prodNotification.type === 'success'
                      ? 'bg-green-100 text-green-600'
                      : prodNotification.type === 'warning'
                      ? 'bg-amber-100 text-amber-600'
                      : 'bg-red-100 text-red-600'
                  }`}>
                    {prodNotification.type === 'success' ? '✓' : 
                     prodNotification.type === 'warning' ? '!' : '✕'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${
                      prodNotification.type === 'success'
                        ? 'text-green-800'
                        : prodNotification.type === 'warning'
                        ? 'text-amber-800'
                        : 'text-red-800'
                    }`}>
                      {prodNotification.title}
                    </p>
                    <p className={`text-sm mt-0.5 ${
                      prodNotification.type === 'success'
                        ? 'text-green-600'
                        : prodNotification.type === 'warning'
                        ? 'text-amber-600'
                        : 'text-red-600'
                    }`}>
                      {prodNotification.message}
                    </p>
                  </div>
                  <button
                    onClick={() => setProdNotification(null)}
                    className={`flex-shrink-0 p-1 rounded hover:bg-opacity-20 ${
                      prodNotification.type === 'success'
                        ? 'text-green-500 hover:bg-green-500'
                        : prodNotification.type === 'warning'
                        ? 'text-amber-500 hover:bg-amber-500'
                        : 'text-red-500 hover:bg-red-500'
                    }`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SKU Comment Form Modal */}
        {showSkuCommentForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Add SKU Comment</h3>
                <p className="text-sm text-gray-500 mt-1">Add a note to a SKU that will show on hover</p>
              </div>
              <div className="px-6 py-4">
                {/* SKU Search */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                  <div className="relative" ref={commentSkuSearchRef}>
                    <input
                      type="text"
                      value={commentSkuSearch}
                      onChange={(e) => {
                        setCommentSkuSearch(e.target.value.toUpperCase());
                        setShowCommentSkuSuggestions(true);
                        // If exact match, select it
                        const exactMatch = inventoryData?.inventory.find(
                          inv => inv.sku.toUpperCase() === e.target.value.toUpperCase()
                        );
                        if (exactMatch) {
                          setCommentSkuSelected(exactMatch.sku);
                          // Load existing comment if any
                          const existingComment = skuComments[exactMatch.sku.toUpperCase()];
                          setCommentText(existingComment?.comment || '');
                        } else {
                          setCommentSkuSelected('');
                          setCommentText('');
                        }
                      }}
                      onFocus={() => setShowCommentSkuSuggestions(true)}
                      placeholder="Search for SKU..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                    {/* SKU Suggestions */}
                    {showCommentSkuSuggestions && commentSkuSearch.length >= 2 && inventoryData?.inventory && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {inventoryData.inventory
                          .filter(inv => 
                            inv.sku.toUpperCase().includes(commentSkuSearch) ||
                            inv.productTitle.toLowerCase().includes(commentSkuSearch.toLowerCase())
                          )
                          .slice(0, 8)
                          .map((inv) => (
                            <button
                              key={inv.sku}
                              onClick={() => {
                                setCommentSkuSearch(inv.sku);
                                setCommentSkuSelected(inv.sku);
                                setShowCommentSkuSuggestions(false);
                                // Load existing comment if any
                                const existingComment = skuComments[inv.sku.toUpperCase()];
                                setCommentText(existingComment?.comment || '');
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 border-b border-gray-100 last:border-b-0"
                            >
                              <span className="font-medium">{inv.sku}</span>
                              {skuComments[inv.sku.toUpperCase()] && <span className="ml-1">💬</span>}
                              <span className="text-gray-500 ml-2 text-xs">{inv.productTitle}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                  {commentSkuSelected && (
                    <p className="text-xs text-green-600 mt-1">Selected: {commentSkuSelected}</p>
                  )}
                </div>

                {/* Comment Input */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Comment</label>
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Enter your comment..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Leave empty to remove the comment</p>
                </div>

                {/* Existing Comment Info */}
                {commentSkuSelected && skuComments[commentSkuSelected.toUpperCase()] && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-md">
                    <p className="text-xs text-gray-500">
                      Current comment by {skuComments[commentSkuSelected.toUpperCase()].updatedBy} on{' '}
                      {new Date(skuComments[commentSkuSelected.toUpperCase()].updatedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                    </p>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex gap-3">
                <button
                  onClick={() => {
                    setShowSkuCommentForm(false);
                    setCommentSkuSearch('');
                    setCommentSkuSelected('');
                    setCommentText('');
                  }}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSkuComment}
                  disabled={!commentSkuSelected || isSavingComment}
                  className={`flex-1 px-4 py-2 text-sm font-medium rounded-md ${
                    !commentSkuSelected || isSavingComment
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isSavingComment ? 'Saving...' : 'Save Comment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Hidden SKUs Modal (for Inventory Counts) */}
        {showHiddenSkusModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Hidden SKUs</h3>
                <p className="text-sm text-gray-500 mt-1">These SKUs are hidden from the Inventory Counts tab</p>
              </div>
              <div className="px-6 py-4 flex-1 overflow-y-auto">
                {/* Add new SKU with autocomplete */}
                <div className="mb-4">
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={newHiddenSku}
                        onChange={(e) => setNewHiddenSku(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && addHiddenSku()}
                        placeholder="Enter SKU to hide..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                      {/* SKU Suggestions Dropdown */}
                      {newHiddenSku.length >= 2 && inventoryData?.inventory && (() => {
                        const suggestions = inventoryData.inventory
                          .filter(inv => 
                            inv.sku.toUpperCase().includes(newHiddenSku) &&
                            !hiddenSkus.some(s => s.toLowerCase() === inv.sku.toLowerCase())
                          )
                          .slice(0, 8);
                        
                        if (suggestions.length === 0) return null;
                        
                        return (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                            {suggestions.map((inv) => (
                              <button
                                key={inv.sku}
                                onClick={() => {
                                  setNewHiddenSku(inv.sku);
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
                      onClick={addHiddenSku}
                      disabled={isAddingHiddenSku || !newHiddenSku.trim()}
                      className={`px-4 py-2 text-sm font-medium rounded-md ${
                        isAddingHiddenSku || !newHiddenSku.trim()
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {isAddingHiddenSku ? 'Adding...' : 'Hide'}
                    </button>
                  </div>
                </div>

                {/* List of hidden SKUs */}
                {hiddenSkus.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No SKUs are hidden</p>
                ) : (
                  <div className="space-y-2">
                    {[...hiddenSkus].sort((a, b) => a.localeCompare(b)).map((sku) => (
                      <div key={sku} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-md">
                        <span className="text-sm font-medium text-gray-900">{sku}</span>
                        <button
                          onClick={() => removeHiddenSku(sku)}
                          disabled={isRemovingHiddenSku === sku}
                          className={`text-xs ${
                            isRemovingHiddenSku === sku
                              ? 'text-gray-400 cursor-not-allowed'
                              : 'text-blue-600 hover:text-blue-800 hover:underline'
                          }`}
                        >
                          {isRemovingHiddenSku === sku ? 'Showing...' : 'Show'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={() => setShowHiddenSkusModal(false)}
                  className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
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
    </>
  );
}
