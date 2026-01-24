import { google } from 'googleapis';

/**
 * Production Order types and cache service
 */

export interface ProductionOrderItem {
  sku: string;
  quantity: number;
  receivedQuantity: number; // Track how much has been received
}

export interface ActivityLogEntry {
  timestamp: string;
  action: string;
  changedBy: string;
  changedByEmail: string;
  details?: string;
}

export interface ProductionOrder {
  id: string;
  poNumber?: string; // User-provided PO number
  items: ProductionOrderItem[];
  notes: string;
  vendor?: string;
  eta?: string; // ISO date string
  status: 'in_production' | 'partial' | 'completed' | 'cancelled';
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  activityLog?: ActivityLogEntry[];
}

export interface ProductionOrdersCache {
  orders: ProductionOrder[];
  lastUpdated: string;
  nextOrderNumber?: number; // Track sequential PO numbers
}

export class ProductionOrdersService {
  private static readonly CACHE_FILE_NAME = 'production-orders.json';
  private static readonly SHARED_DRIVE_NAME = 'ProjectionsVsActual Cache';

  /**
   * Get authenticated Google Drive client
   */
  private static async getDriveClient() {
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const serviceAccountPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    const projectId = process.env.GOOGLE_PROJECT_ID;

    if (!serviceAccountEmail || !serviceAccountPrivateKey || !projectId) {
      throw new Error('Missing Google Drive environment variables');
    }

    let formattedKey = serviceAccountPrivateKey;
    if (formattedKey.includes('\\n')) {
      formattedKey = formattedKey.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: serviceAccountEmail,
        private_key: formattedKey,
        project_id: projectId,
      },
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.readonly'
      ],
    });

    return google.drive({ version: 'v3', auth });
  }

  /**
   * Find the shared drive
   */
  private static async findSharedDrive(drive: ReturnType<typeof google.drive>): Promise<string> {
    const response = await drive.drives.list();
    const sharedDrive = response.data.drives?.find(
      (d) => d.name === ProductionOrdersService.SHARED_DRIVE_NAME
    );

    if (!sharedDrive) {
      throw new Error(`Shared drive '${ProductionOrdersService.SHARED_DRIVE_NAME}' not found`);
    }

    return sharedDrive.id!;
  }

  /**
   * Find or create the cache folder
   */
  private static async findOrCreateFolder(
    drive: ReturnType<typeof google.drive>,
    sharedDriveId: string
  ): Promise<string> {
    const searchResponse = await drive.files.list({
      q: `name='Inventory-Cache' and parents='${sharedDriveId}' and mimeType='application/vnd.google-apps.folder'`,
      driveId: sharedDriveId,
      corpora: 'drive',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id!;
    }

    const folderResponse = await drive.files.create({
      requestBody: {
        name: 'Inventory-Cache',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [sharedDriveId],
      },
      supportsAllDrives: true,
    });

    return folderResponse.data.id!;
  }

  /**
   * Find the production orders file
   */
  private static async findCacheFile(
    drive: ReturnType<typeof google.drive>,
    folderId: string,
    sharedDriveId: string
  ): Promise<string | null> {
    try {
      const response = await drive.files.list({
        q: `parents='${folderId}' and name='${ProductionOrdersService.CACHE_FILE_NAME}'`,
        driveId: sharedDriveId,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
      });
      
      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id!;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to search for production orders file:', error);
      throw error;
    }
  }

  /**
   * Load all production orders
   */
  static async loadOrders(): Promise<ProductionOrdersCache> {
    try {
      console.log('📥 Loading production orders from Google Drive...');
      
      const drive = await ProductionOrdersService.getDriveClient();
      const sharedDriveId = await ProductionOrdersService.findSharedDrive(drive);
      const folderId = await ProductionOrdersService.findOrCreateFolder(drive, sharedDriveId);
      const fileId = await ProductionOrdersService.findCacheFile(drive, folderId, sharedDriveId);

      if (!fileId) {
        console.log('📭 No production orders file found, returning empty');
        return { orders: [], lastUpdated: new Date().toISOString() };
      }

      const response = await drive.files.get({
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      });

      let dataString: string;
      
      if (typeof response.data === 'string') {
        dataString = response.data;
      } else if (response.data instanceof Buffer) {
        dataString = response.data.toString('utf8');
      } else if (response.data && typeof response.data === 'object') {
        const data = response.data as Record<string, unknown>;
        if (data.orders) {
          console.log('✅ Loaded production orders from Google Drive');
          return response.data as ProductionOrdersCache;
        }
        throw new Error('Invalid production orders data format');
      } else {
        throw new Error(`Unexpected response data type: ${typeof response.data}`);
      }
      
      const cached = JSON.parse(dataString);
      console.log('✅ Loaded production orders from Google Drive');
      return cached as ProductionOrdersCache;

    } catch (error) {
      console.error('❌ Failed to load production orders:', error);
      return { orders: [], lastUpdated: new Date().toISOString() };
    }
  }

  /**
   * Save production orders
   */
  static async saveOrders(cache: ProductionOrdersCache): Promise<void> {
    try {
      console.log('💾 Saving production orders to Google Drive...');
      
      const drive = await ProductionOrdersService.getDriveClient();
      const sharedDriveId = await ProductionOrdersService.findSharedDrive(drive);
      const folderId = await ProductionOrdersService.findOrCreateFolder(drive, sharedDriveId);

      const fileContent = JSON.stringify(cache, null, 2);
      const existingFileId = await ProductionOrdersService.findCacheFile(drive, folderId, sharedDriveId);

      if (existingFileId) {
        await drive.files.update({
          fileId: existingFileId,
          media: {
            mimeType: 'application/json',
            body: require('stream').Readable.from([fileContent]),
          },
          supportsAllDrives: true,
        });
        console.log('✅ Updated production orders in Google Drive');
      } else {
        await drive.files.create({
          requestBody: {
            name: ProductionOrdersService.CACHE_FILE_NAME,
            parents: [folderId],
          },
          media: {
            mimeType: 'application/json',
            body: require('stream').Readable.from([fileContent]),
          },
          supportsAllDrives: true,
        });
        console.log('✅ Created new production orders file in Google Drive');
      }

    } catch (error) {
      console.error('❌ Failed to save production orders:', error);
      throw error;
    }
  }

  /**
   * Create a new production order
   */
  static async createOrder(
    items: { sku: string; quantity: number }[],
    notes: string,
    createdBy: string,
    createdByEmail: string,
    vendor?: string,
    eta?: string,
    poNumber?: string
  ): Promise<ProductionOrder> {
    const cache = await ProductionOrdersService.loadOrders();
    
    // Generate sequential PO number for internal ID
    const nextNum = cache.nextOrderNumber || 1;
    const orderId = `PO-${String(nextNum).padStart(3, '0')}`;
    cache.nextOrderNumber = nextNum + 1;
    
    // Initialize items with receivedQuantity = 0
    const orderItems: ProductionOrderItem[] = items.map(item => ({
      sku: item.sku,
      quantity: item.quantity,
      receivedQuantity: 0,
    }));
    
    const now = new Date().toISOString();
    const itemsSummary = orderItems.map(i => `${i.sku} x${i.quantity}`).join(', ');
    
    const newOrder: ProductionOrder = {
      id: orderId,
      poNumber: poNumber || undefined, // User-provided PO number
      items: orderItems,
      notes,
      vendor,
      eta,
      status: 'in_production',
      createdBy,
      createdByEmail,
      createdAt: now,
      updatedAt: now,
      activityLog: [{
        timestamp: now,
        action: 'PO Created',
        changedBy: createdBy,
        changedByEmail: createdByEmail,
        details: itemsSummary,
      }],
    };

    cache.orders.unshift(newOrder); // Add to beginning
    cache.lastUpdated = new Date().toISOString();
    
    await ProductionOrdersService.saveOrders(cache);
    
    return newOrder;
  }

  /**
   * Update a production order
   */
  static async updateOrder(
    orderId: string,
    updates: Partial<Pick<ProductionOrder, 'notes' | 'poNumber' | 'vendor' | 'eta' | 'status'>> & {
      items?: { sku: string; quantity: number }[];
    },
    changedBy?: string,
    changedByEmail?: string
  ): Promise<ProductionOrder | null> {
    const cache = await ProductionOrdersService.loadOrders();
    
    const orderIndex = cache.orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return null;

    const order = cache.orders[orderIndex];
    const now = new Date().toISOString();
    const changes: string[] = [];
    
    // Initialize activity log if missing
    if (!order.activityLog) {
      order.activityLog = [];
    }
    
    // Update items if provided (preserve receivedQuantity for existing SKUs)
    if (updates.items) {
      const oldItems = order.items.map(i => `${i.sku} x${i.quantity}`).join(', ');
      const newItems = updates.items.map(i => `${i.sku} x${i.quantity}`).join(', ');
      if (oldItems !== newItems) {
        changes.push(`Items: ${newItems}`);
      }
      order.items = updates.items.map(newItem => {
        const existingItem = order.items.find(i => i.sku === newItem.sku);
        return {
          sku: newItem.sku,
          quantity: newItem.quantity,
          receivedQuantity: existingItem?.receivedQuantity || 0,
        };
      });
    }
    
    if (updates.notes !== undefined && updates.notes !== order.notes) {
      changes.push('Notes updated');
      order.notes = updates.notes;
    }
    if (updates.poNumber !== undefined && updates.poNumber !== order.poNumber) {
      changes.push(`PO#: ${updates.poNumber || 'cleared'}`);
      order.poNumber = updates.poNumber;
    }
    if (updates.vendor !== undefined && updates.vendor !== order.vendor) {
      changes.push(`Vendor: ${updates.vendor || 'cleared'}`);
      order.vendor = updates.vendor;
    }
    if (updates.eta !== undefined && updates.eta !== order.eta) {
      changes.push(`ETA: ${updates.eta ? new Date(updates.eta).toLocaleDateString() : 'cleared'}`);
      order.eta = updates.eta;
    }
    if (updates.status && updates.status !== order.status) {
      const statusLabels: Record<string, string> = {
        'in_production': 'In Production',
        'partial': 'Partial Delivery',
        'completed': 'Completed',
        'cancelled': 'Cancelled',
      };
      changes.push(`Status: ${statusLabels[updates.status]}`);
      order.status = updates.status;
      if (updates.status === 'completed') {
        order.completedAt = now;
      }
      if (updates.status === 'cancelled') {
        order.cancelledAt = now;
      }
    }
    
    // Add activity log entry if there were changes
    if (changes.length > 0 && changedBy && changedByEmail) {
      order.activityLog.push({
        timestamp: now,
        action: 'Order Updated',
        changedBy,
        changedByEmail,
        details: changes.join('; '),
      });
    }
    
    order.updatedAt = now;

    cache.lastUpdated = now;
    await ProductionOrdersService.saveOrders(cache);
    
    return order;
  }

  /**
   * Get pending PO quantities by SKU (ordered - received)
   */
  static async getPendingQuantitiesBySku(): Promise<Map<string, number>> {
    const cache = await ProductionOrdersService.loadOrders();
    const quantities = new Map<string, number>();

    for (const order of cache.orders) {
      // Only count in_production and partial orders (not completed)
      if (['in_production', 'partial'].includes(order.status)) {
        for (const item of order.items) {
          // Pending = ordered - received
          const pending = item.quantity - (item.receivedQuantity || 0);
          if (pending > 0) {
            const current = quantities.get(item.sku) || 0;
            quantities.set(item.sku, current + pending);
          }
        }
      }
    }

    return quantities;
  }

  /**
   * Log a partial or full delivery for an order
   */
  static async logDelivery(
    orderId: string,
    deliveries: { sku: string; quantity: number }[],
    changedBy?: string,
    changedByEmail?: string
  ): Promise<ProductionOrder | null> {
    const cache = await ProductionOrdersService.loadOrders();
    
    const orderIndex = cache.orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return null;

    const order = cache.orders[orderIndex];
    const now = new Date().toISOString();
    
    // Initialize activity log if missing
    if (!order.activityLog) {
      order.activityLog = [];
    }
    
    // Update received quantities
    const deliveryDetails: string[] = [];
    for (const delivery of deliveries) {
      const item = order.items.find(i => i.sku === delivery.sku);
      if (item && delivery.quantity > 0) {
        item.receivedQuantity = (item.receivedQuantity || 0) + delivery.quantity;
        // Cap at ordered quantity
        if (item.receivedQuantity > item.quantity) {
          item.receivedQuantity = item.quantity;
        }
        deliveryDetails.push(`${item.sku} x${delivery.quantity}`);
      }
    }

    // Check if all items are fully received
    const allReceived = order.items.every(item => 
      (item.receivedQuantity || 0) >= item.quantity
    );
    
    const anyReceived = order.items.some(item => 
      (item.receivedQuantity || 0) > 0
    );

    // Update status based on delivery state
    const oldStatus = order.status;
    if (allReceived) {
      order.status = 'completed';
      order.completedAt = now;
    } else if (anyReceived) {
      order.status = 'partial';
    }

    // Add activity log entry
    if (deliveryDetails.length > 0 && changedBy && changedByEmail) {
      let action = 'Delivery Logged';
      if (allReceived && oldStatus !== 'completed') {
        action = 'Delivery Logged (Order Completed)';
      }
      order.activityLog.push({
        timestamp: now,
        action,
        changedBy,
        changedByEmail,
        details: deliveryDetails.join(', '),
      });
    }

    order.updatedAt = now;
    cache.lastUpdated = now;
    
    await ProductionOrdersService.saveOrders(cache);
    
    return order;
  }
}
