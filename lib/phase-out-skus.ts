import { google } from 'googleapis';

/**
 * Phase Out SKUs service
 * Manages a list of SKUs that are being phased out
 */

export interface PhaseOutSKU {
  sku: string;
  addedAt: string;
  addedBy: string;
  addedByEmail: string;
}

export interface PhaseOutCache {
  skus: PhaseOutSKU[];
  lastUpdated: string;
}

export class PhaseOutService {
  private static readonly CACHE_FILE_NAME = 'phase-out-skus.json';
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
  private static async findSharedDrive(drive: ReturnType<typeof google.drive>) {
    const response = await drive.drives.list({
      pageSize: 100,
    });

    const sharedDrive = response.data.drives?.find(
      d => d.name === this.SHARED_DRIVE_NAME
    );

    if (!sharedDrive?.id) {
      throw new Error(`Shared drive "${this.SHARED_DRIVE_NAME}" not found`);
    }

    return sharedDrive.id;
  }

  /**
   * Find or create the cache file
   */
  private static async findOrCreateCacheFile(
    drive: ReturnType<typeof google.drive>,
    driveId: string
  ): Promise<string> {
    // Search for existing file
    const searchResponse = await drive.files.list({
      q: `name='${this.CACHE_FILE_NAME}' and '${driveId}' in parents and trashed=false`,
      driveId: driveId,
      corpora: 'drive',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'files(id, name)',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id!;
    }

    // Create new file with empty cache
    const emptyCache: PhaseOutCache = {
      skus: [],
      lastUpdated: new Date().toISOString(),
    };

    const createResponse = await drive.files.create({
      requestBody: {
        name: this.CACHE_FILE_NAME,
        mimeType: 'application/json',
        parents: [driveId],
      },
      media: {
        mimeType: 'application/json',
        body: JSON.stringify(emptyCache, null, 2),
      },
      supportsAllDrives: true,
      fields: 'id',
    });

    return createResponse.data.id!;
  }

  /**
   * Get all phase out SKUs
   */
  static async getPhaseOutSKUs(): Promise<PhaseOutCache> {
    const drive = await this.getDriveClient();
    const driveId = await this.findSharedDrive(drive);
    const fileId = await this.findOrCreateCacheFile(drive, driveId);

    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
      supportsAllDrives: true,
    });

    return response.data as PhaseOutCache;
  }

  /**
   * Save phase out cache
   */
  private static async saveCache(cache: PhaseOutCache): Promise<void> {
    const drive = await this.getDriveClient();
    const driveId = await this.findSharedDrive(drive);
    const fileId = await this.findOrCreateCacheFile(drive, driveId);

    await drive.files.update({
      fileId: fileId,
      media: {
        mimeType: 'application/json',
        body: JSON.stringify(cache, null, 2),
      },
      supportsAllDrives: true,
    });
  }

  /**
   * Add SKU to phase out list
   */
  static async addSKU(sku: string, userName: string, userEmail: string): Promise<PhaseOutCache> {
    const cache = await this.getPhaseOutSKUs();
    
    // Check if already exists
    if (cache.skus.some(s => s.sku.toLowerCase() === sku.toLowerCase())) {
      return cache; // Already in list
    }

    cache.skus.push({
      sku: sku.toUpperCase(),
      addedAt: new Date().toISOString(),
      addedBy: userName,
      addedByEmail: userEmail,
    });
    cache.lastUpdated = new Date().toISOString();

    await this.saveCache(cache);
    return cache;
  }

  /**
   * Remove SKU from phase out list
   */
  static async removeSKU(sku: string): Promise<PhaseOutCache> {
    const cache = await this.getPhaseOutSKUs();
    
    cache.skus = cache.skus.filter(s => s.sku.toLowerCase() !== sku.toLowerCase());
    cache.lastUpdated = new Date().toISOString();

    await this.saveCache(cache);
    return cache;
  }

  /**
   * Check if SKU is in phase out list
   */
  static async isPhaseOut(sku: string): Promise<boolean> {
    const cache = await this.getPhaseOutSKUs();
    return cache.skus.some(s => s.sku.toLowerCase() === sku.toLowerCase());
  }
}
