import { google } from 'googleapis';

/**
 * Production Order types and cache service
 */

export interface ProductionOrderItem {
  sku: string;
  quantity: number;
  receivedQuantity: number; // Track how much has been received
}

export interface ProductionOrder {
  id: string;
  items: ProductionOrderItem[];
  notes: string;
  vendor?: string;
  eta?: string; // ISO date string
  status: 'in_production' | 'partial' | 'completed';
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ProductionOrdersCache {
  orders: ProductionOrder[];
  lastUpdated: string;
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
    eta?: string
  ): Promise<ProductionOrder> {
    const cache = await ProductionOrdersService.loadOrders();
    
    // Initialize items with receivedQuantity = 0
    const orderItems: ProductionOrderItem[] = items.map(item => ({
      sku: item.sku,
      quantity: item.quantity,
      receivedQuantity: 0,
    }));
    
    const newOrder: ProductionOrder = {
      id: `PO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      items: orderItems,
      notes,
      vendor,
      eta,
      status: 'in_production',
      createdBy,
      createdByEmail,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    updates: Partial<Pick<ProductionOrder, 'notes' | 'vendor' | 'eta' | 'status'>>
  ): Promise<ProductionOrder | null> {
    const cache = await ProductionOrdersService.loadOrders();
    
    const orderIndex = cache.orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return null;

    const order = cache.orders[orderIndex];
    
    if (updates.notes !== undefined) order.notes = updates.notes;
    if (updates.vendor !== undefined) order.vendor = updates.vendor;
    if (updates.eta !== undefined) order.eta = updates.eta;
    if (updates.status) {
      order.status = updates.status;
      if (updates.status === 'completed') {
        order.completedAt = new Date().toISOString();
      }
    }
    order.updatedAt = new Date().toISOString();

    cache.lastUpdated = new Date().toISOString();
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
    deliveries: { sku: string; quantity: number }[]
  ): Promise<ProductionOrder | null> {
    const cache = await ProductionOrdersService.loadOrders();
    
    const orderIndex = cache.orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return null;

    const order = cache.orders[orderIndex];
    
    // Update received quantities
    for (const delivery of deliveries) {
      const item = order.items.find(i => i.sku === delivery.sku);
      if (item) {
        item.receivedQuantity = (item.receivedQuantity || 0) + delivery.quantity;
        // Cap at ordered quantity
        if (item.receivedQuantity > item.quantity) {
          item.receivedQuantity = item.quantity;
        }
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
    if (allReceived) {
      order.status = 'completed';
      order.completedAt = new Date().toISOString();
    } else if (anyReceived) {
      order.status = 'partial';
    }

    order.updatedAt = new Date().toISOString();
    cache.lastUpdated = new Date().toISOString();
    
    await ProductionOrdersService.saveOrders(cache);
    
    return order;
  }
}
