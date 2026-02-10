import { google } from 'googleapis';

/**
 * Transfer types and cache service
 */

export interface TransferItem {
  sku: string;
  quantity: number;
  receivedQuantity?: number;
  pallet?: string; // For sea shipments: Pallet 1, Pallet 2, etc.
  masterCartons?: number; // Number of master cartons
}

export interface ActivityLogEntry {
  timestamp: string;
  action: string;
  changedBy: string;
  changedByEmail: string;
  details?: string;
}

export type TransferStatus = 'draft' | 'in_transit' | 'partial' | 'delivered' | 'cancelled';
export type CarrierType = 'FedEx' | 'DHL' | 'UPS' | '';
export type TransferType = 'Air Express' | 'Air Slow' | 'Sea' | 'Immediate';

export interface Transfer {
  id: string; // T0001, T0002, etc.
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

export interface TransfersCache {
  transfers: Transfer[];
  lastUpdated: string;
  nextTransferNumber?: number; // Track sequential transfer numbers
}

export class TransfersService {
  private static readonly CACHE_FILE_NAME = 'transfers.json';
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
      (d) => d.name === TransfersService.SHARED_DRIVE_NAME
    );

    if (!sharedDrive) {
      throw new Error(`Shared drive '${TransfersService.SHARED_DRIVE_NAME}' not found`);
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
   * Find the transfers file
   */
  private static async findCacheFile(
    drive: ReturnType<typeof google.drive>,
    folderId: string,
    sharedDriveId: string
  ): Promise<string | null> {
    try {
      const response = await drive.files.list({
        q: `parents='${folderId}' and name='${TransfersService.CACHE_FILE_NAME}'`,
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
      console.error('Failed to search for transfers file:', error);
      throw error;
    }
  }

  /**
   * Load all transfers
   */
  static async loadTransfers(): Promise<TransfersCache> {
    try {
      console.log('📥 Loading transfers from Google Drive...');
      
      const drive = await TransfersService.getDriveClient();
      const sharedDriveId = await TransfersService.findSharedDrive(drive);
      const folderId = await TransfersService.findOrCreateFolder(drive, sharedDriveId);
      const fileId = await TransfersService.findCacheFile(drive, folderId, sharedDriveId);

      if (!fileId) {
        console.log('📭 No transfers file found, returning empty');
        return { transfers: [], lastUpdated: new Date().toISOString() };
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
        if (data.transfers) {
          console.log('✅ Loaded transfers from Google Drive');
          return response.data as TransfersCache;
        }
        throw new Error('Invalid transfers data format');
      } else {
        throw new Error(`Unexpected response data type: ${typeof response.data}`);
      }
      
      const cached = JSON.parse(dataString);
      console.log('✅ Loaded transfers from Google Drive');
      return cached as TransfersCache;

    } catch (error) {
      console.error('❌ Failed to load transfers:', error);
      return { transfers: [], lastUpdated: new Date().toISOString() };
    }
  }

  /**
   * Save transfers
   */
  static async saveTransfers(cache: TransfersCache): Promise<void> {
    try {
      console.log('💾 Saving transfers to Google Drive...');
      
      const drive = await TransfersService.getDriveClient();
      const sharedDriveId = await TransfersService.findSharedDrive(drive);
      const folderId = await TransfersService.findOrCreateFolder(drive, sharedDriveId);

      const fileContent = JSON.stringify(cache, null, 2);
      const existingFileId = await TransfersService.findCacheFile(drive, folderId, sharedDriveId);

      if (existingFileId) {
        await drive.files.update({
          fileId: existingFileId,
          media: {
            mimeType: 'application/json',
            body: require('stream').Readable.from([fileContent]),
          },
          supportsAllDrives: true,
        });
        console.log('✅ Updated transfers in Google Drive');
      } else {
        await drive.files.create({
          requestBody: {
            name: TransfersService.CACHE_FILE_NAME,
            parents: [folderId],
          },
          media: {
            mimeType: 'application/json',
            body: require('stream').Readable.from([fileContent]),
          },
          supportsAllDrives: true,
        });
        console.log('✅ Created new transfers file in Google Drive');
      }

    } catch (error) {
      console.error('❌ Failed to save transfers:', error);
      throw error;
    }
  }

  /**
   * Create a new transfer
   */
  static async createTransfer(
    origin: string,
    destination: string,
    transferType: TransferType,
    items: TransferItem[],
    createdBy: string,
    createdByEmail: string,
    carrier?: CarrierType,
    trackingNumber?: string,
    eta?: string,
    notes?: string
  ): Promise<Transfer> {
    const cache = await TransfersService.loadTransfers();
    
    // Generate sequential transfer number
    const nextNum = cache.nextTransferNumber || 1;
    const transferId = `T${String(nextNum).padStart(4, '0')}`;
    cache.nextTransferNumber = nextNum + 1;
    
    const now = new Date().toISOString();
    const itemsSummary = items.map(i => `- ${i.sku} → ${i.quantity}${i.masterCartons ? ` (${i.masterCartons} MCs)` : ''}`).join('\n');
    
    // Build activity log details with notes if present
    let creationDetails = `[${transferType}] ${origin} → ${destination}:\n${itemsSummary}`;
    if (notes && notes.trim()) {
      creationDetails += `\nNotes: ${notes.trim()}`;
    }
    
    const newTransfer: Transfer = {
      id: transferId,
      origin,
      destination,
      transferType,
      items,
      carrier: carrier || '',
      trackingNumber: trackingNumber || '',
      eta: eta || undefined,
      notes: notes || '',
      status: 'draft',
      createdBy,
      createdByEmail,
      createdAt: now,
      updatedAt: now,
      activityLog: [{
        timestamp: now,
        action: 'Transfer Created',
        changedBy: createdBy,
        changedByEmail: createdByEmail,
        details: creationDetails,
      }],
    };

    cache.transfers.unshift(newTransfer); // Add to beginning
    cache.lastUpdated = new Date().toISOString();
    
    await TransfersService.saveTransfers(cache);
    
    return newTransfer;
  }

  /**
   * Update a transfer
   */
  static async updateTransfer(
    transferId: string,
    updates: Partial<Pick<Transfer, 'origin' | 'destination' | 'transferType' | 'items' | 'carrier' | 'trackingNumber' | 'eta' | 'notes' | 'status'>>,
    changedBy?: string,
    changedByEmail?: string
  ): Promise<Transfer | null> {
    const cache = await TransfersService.loadTransfers();
    
    const transferIndex = cache.transfers.findIndex(t => t.id === transferId);
    if (transferIndex === -1) return null;

    const transfer = cache.transfers[transferIndex];
    const now = new Date().toISOString();
    const changes: string[] = [];
    
    // Initialize activity log if missing
    if (!transfer.activityLog) {
      transfer.activityLog = [];
    }
    
    // Update fields if provided
    if (updates.origin !== undefined && updates.origin !== transfer.origin) {
      changes.push(`Origin: ${updates.origin}`);
      transfer.origin = updates.origin;
    }
    if (updates.destination !== undefined && updates.destination !== transfer.destination) {
      changes.push(`Destination: ${updates.destination}`);
      transfer.destination = updates.destination;
    }
    if (updates.transferType !== undefined && updates.transferType !== transfer.transferType) {
      changes.push(`Transfer Type: ${updates.transferType}`);
      transfer.transferType = updates.transferType;
    }
    if (updates.items !== undefined) {
      // Check if this is a delivery update (items have receivedQuantity changes)
      const isDeliveryUpdate = updates.items.some((newItem, idx) => {
        const oldItem = transfer.items.find(i => i.sku === newItem.sku);
        return oldItem && (newItem.receivedQuantity || 0) > (oldItem.receivedQuantity || 0);
      });
      
      if (isDeliveryUpdate) {
        // Format delivery details as list with MCs: "- SKU → qty (X MCs)"
        const deliveryDetails = updates.items
          .filter(newItem => {
            const oldItem = transfer.items.find(i => i.sku === newItem.sku);
            return oldItem && (newItem.receivedQuantity || 0) > (oldItem.receivedQuantity || 0);
          })
          .map(newItem => {
            const oldItem = transfer.items.find(i => i.sku === newItem.sku);
            const thisDelivery = (newItem.receivedQuantity || 0) - (oldItem?.receivedQuantity || 0);
            const mcInfo = newItem.masterCartons ? ` (${newItem.masterCartons} MCs)` : '';
            return `- ${newItem.sku} → ${thisDelivery.toLocaleString()}${mcInfo}`;
          })
          .join('\n');
        changes.push(deliveryDetails);
        transfer.items = updates.items;
      } else {
        const oldItems = transfer.items.map(i => `${i.sku} → ${i.quantity}${i.masterCartons ? ` (${i.masterCartons} MCs)` : ''}`).join('\n');
        const newItemsNormalized = updates.items.map(i => `${i.sku} → ${i.quantity}${i.masterCartons ? ` (${i.masterCartons} MCs)` : ''}`).join('\n');
        if (oldItems !== newItemsNormalized) {
          const newItemsDisplay = updates.items.map(i => `- ${i.sku} → ${i.quantity}${i.masterCartons ? ` (${i.masterCartons} MCs)` : ''}`).join('\n');
          changes.push(`Items:\n${newItemsDisplay}`);
          transfer.items = updates.items;
        }
      }
    }
    if (updates.carrier !== undefined && updates.carrier !== transfer.carrier) {
      changes.push(`Carrier: ${updates.carrier || 'cleared'}`);
      transfer.carrier = updates.carrier;
    }
    if (updates.trackingNumber !== undefined && updates.trackingNumber !== transfer.trackingNumber) {
      changes.push(`Tracking: ${updates.trackingNumber || 'cleared'}`);
      transfer.trackingNumber = updates.trackingNumber;
    }
    // Track ETA changes separately for special handling
    let etaChanged = false;
    let newEtaValue: string | null | undefined = undefined;
    // Normalize both values for comparison (treat null, undefined, and '' as equivalent "no eta")
    const currentEta = transfer.eta || null;
    const incomingEta = updates.eta === undefined ? undefined : (updates.eta || null);
    if (incomingEta !== undefined && incomingEta !== currentEta) {
      etaChanged = true;
      newEtaValue = incomingEta;
      transfer.eta = incomingEta || undefined;
    }
    
    // Track notes changes separately for special handling
    let notesChanged = false;
    let newNotesContent = '';
    if (updates.notes !== undefined && updates.notes !== transfer.notes) {
      notesChanged = true;
      newNotesContent = updates.notes;
      transfer.notes = updates.notes;
    }
    
    if (updates.status && updates.status !== transfer.status) {
      const statusLabels: Record<string, string> = {
        'draft': 'Draft',
        'in_transit': 'In Transit',
        'partial': 'Partial',
        'delivered': 'Delivered',
        'cancelled': 'Cancelled',
      };
      changes.push(`Status: ${statusLabels[updates.status]}`);
      transfer.status = updates.status;
      if (updates.status === 'delivered') {
        transfer.deliveredAt = now;
      }
      if (updates.status === 'cancelled') {
        transfer.cancelledAt = now;
      }
    }
    
    // Add activity log entry if there were changes (not counting notes which are handled separately)
    if (changes.length > 0 && changedBy && changedByEmail) {
      // Check if this is a delivery update (has "- SKU → qty" format, possibly multi-line)
      const deliveryItemsChange = changes.find(c => c.startsWith('- ') && c.includes(' → ') && !c.startsWith('Status:'));
      const statusChange = changes.find(c => c.startsWith('Status:'));
      const isDeliveryLog = !!deliveryItemsChange;
      
      let action = 'Transfer Updated';
      let details = changes.join('\n');
      
      if (isDeliveryLog) {
        action = 'Delivery Logged';
        // Details: item list + status on following line
        details = deliveryItemsChange + (statusChange ? `\n${statusChange}` : '');
      } else if (updates.status === 'cancelled') {
        action = 'Transfer Cancelled';
      } else if (updates.status === 'in_transit') {
        action = 'Marked In Transit';
      }
      
      transfer.activityLog.push({
        timestamp: now,
        action,
        changedBy,
        changedByEmail,
        details: details || undefined,
      });
    }
    
    // Handle notes changes as a separate "Notes Updated" entry
    if (notesChanged && changedBy && changedByEmail) {
      transfer.activityLog.push({
        timestamp: now,
        action: 'Notes Updated',
        changedBy,
        changedByEmail,
        details: newNotesContent.trim() || 'Notes cleared',
      });
    }
    
    // Handle ETA changes as a separate "Est. Delivery Updated" entry
    if (etaChanged && changedBy && changedByEmail) {
      // Parse date as local to avoid timezone shift (YYYY-MM-DD -> local midnight)
      let etaDisplay = 'Cleared';
      if (newEtaValue) {
        const [year, month, day] = newEtaValue.split('-').map(Number);
        const localDate = new Date(year, month - 1, day);
        etaDisplay = localDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      transfer.activityLog.push({
        timestamp: now,
        action: 'Est. Delivery Updated',
        changedBy,
        changedByEmail,
        details: etaDisplay,
      });
    }
    
    transfer.updatedAt = now;

    cache.lastUpdated = now;
    await TransfersService.saveTransfers(cache);
    
    return transfer;
  }
}
