import { google } from 'googleapis';

/**
 * SKU Comments service
 * Manages comments for individual SKUs with timestamp and user info
 */

export interface SkuComment {
  sku: string;
  comment: string;
  updatedAt: string;
  updatedBy: string;
  updatedByEmail: string;
}

export interface SkuCommentsCache {
  comments: Record<string, SkuComment>;
  lastUpdated: string;
}

export class SkuCommentsService {
  private static readonly CACHE_FILE_NAME = 'sku-comments.json';
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
    const emptyCache: SkuCommentsCache = {
      comments: {},
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
   * Get all SKU comments
   */
  static async getComments(): Promise<SkuCommentsCache> {
    const drive = await this.getDriveClient();
    const driveId = await this.findSharedDrive(drive);
    const fileId = await this.findOrCreateCacheFile(drive, driveId);

    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
      supportsAllDrives: true,
    });

    return response.data as SkuCommentsCache;
  }

  /**
   * Save comments cache
   */
  private static async saveCache(cache: SkuCommentsCache): Promise<void> {
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
   * Add or update a comment for a SKU
   */
  static async setComment(
    sku: string, 
    comment: string, 
    userName: string, 
    userEmail: string
  ): Promise<SkuCommentsCache> {
    const cache = await this.getComments();
    const now = new Date().toISOString();
    const normalizedSku = sku.toUpperCase();

    if (comment.trim() === '') {
      // Remove comment if empty
      delete cache.comments[normalizedSku];
    } else {
      // Add or update comment
      cache.comments[normalizedSku] = {
        sku: normalizedSku,
        comment: comment.trim(),
        updatedAt: now,
        updatedBy: userName,
        updatedByEmail: userEmail,
      };
    }

    cache.lastUpdated = now;
    await this.saveCache(cache);
    return cache;
  }

  /**
   * Get comment for a specific SKU
   */
  static async getComment(sku: string): Promise<SkuComment | null> {
    const cache = await this.getComments();
    return cache.comments[sku.toUpperCase()] || null;
  }

  /**
   * Delete comment for a SKU
   */
  static async deleteComment(sku: string): Promise<SkuCommentsCache> {
    const cache = await this.getComments();
    delete cache.comments[sku.toUpperCase()];
    cache.lastUpdated = new Date().toISOString();
    await this.saveCache(cache);
    return cache;
  }
}
