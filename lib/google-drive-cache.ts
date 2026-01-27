import { google } from 'googleapis';

/**
 * Google Drive cache for inventory data
 * Provides persistent storage across Vercel serverless functions
 */
export class GoogleDriveCacheService {
  private static readonly CACHE_FILE_NAME = 'inventory-cache.json';
  private static readonly SHARED_DRIVE_NAME = 'ProjectionsVsActual Cache';

  /**
   * Get authenticated Google Drive client
   */
  private static async getDriveClient() {
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const serviceAccountPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    const projectId = process.env.GOOGLE_PROJECT_ID;

    if (!serviceAccountEmail || !serviceAccountPrivateKey || !projectId) {
      throw new Error('Missing Google Drive environment variables: ' + 
        `email=${!!serviceAccountEmail}, key=${!!serviceAccountPrivateKey}, project=${!!projectId}`);
    }

    // Handle private key format - Vercel may store it with literal \n or actual newlines
    let formattedKey = serviceAccountPrivateKey;
    
    // If the key contains literal \n strings, replace them with actual newlines
    if (formattedKey.includes('\\n')) {
      formattedKey = formattedKey.replace(/\\n/g, '\n');
    }
    
    // Ensure key has proper PEM format
    if (!formattedKey.includes('-----BEGIN')) {
      console.error('Private key does not appear to be in PEM format');
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
      (d) => d.name === GoogleDriveCacheService.SHARED_DRIVE_NAME
    );

    if (!sharedDrive) {
      throw new Error(`Shared drive '${GoogleDriveCacheService.SHARED_DRIVE_NAME}' not found`);
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
    // Look for existing folder
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

    // Create new folder
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
   * Find the cache file
   */
  private static async findCacheFile(
    drive: ReturnType<typeof google.drive>,
    folderId: string,
    sharedDriveId: string
  ): Promise<string | null> {
    try {
      const response = await drive.files.list({
        q: `parents='${folderId}' and name='${GoogleDriveCacheService.CACHE_FILE_NAME}'`,
        driveId: sharedDriveId,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name, size, modifiedTime)',
      });
      
      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id!;
      }
      
      return null;
      
    } catch (error) {
      console.error('Failed to search for cache file:', error);
      throw error;
    }
  }

  /**
   * Store inventory data to Google Drive
   */
  static async saveCache(cacheData: unknown): Promise<void> {
    try {
      console.log('💾 Saving inventory cache to Google Drive...');
      
      const drive = await GoogleDriveCacheService.getDriveClient();
      const sharedDriveId = await GoogleDriveCacheService.findSharedDrive(drive);
      const folderId = await GoogleDriveCacheService.findOrCreateFolder(drive, sharedDriveId);

      const fileContent = JSON.stringify(cacheData, null, 2);
      
      const existingFileId = await GoogleDriveCacheService.findCacheFile(drive, folderId, sharedDriveId);

      if (existingFileId) {
        // Update existing file
        await drive.files.update({
          fileId: existingFileId,
          media: {
            mimeType: 'application/json',
            body: require('stream').Readable.from([fileContent]),
          },
          supportsAllDrives: true,
        });
        console.log('✅ Updated inventory cache in Google Drive');
      } else {
        // Create new file
        await drive.files.create({
          requestBody: {
            name: GoogleDriveCacheService.CACHE_FILE_NAME,
            parents: [folderId],
          },
          media: {
            mimeType: 'application/json',
            body: require('stream').Readable.from([fileContent]),
          },
          supportsAllDrives: true,
        });
        console.log('✅ Created new inventory cache in Google Drive');
      }

    } catch (error) {
      console.error('❌ Failed to store inventory data to Google Drive:', error);
      throw error;
    }
  }

  /**
   * Load inventory data from Google Drive
   */
  static async loadCache<T>(): Promise<T | null> {
    try {
      console.log('📥 Loading inventory cache from Google Drive...');
      
      const drive = await GoogleDriveCacheService.getDriveClient();
      const sharedDriveId = await GoogleDriveCacheService.findSharedDrive(drive);
      const folderId = await GoogleDriveCacheService.findOrCreateFolder(drive, sharedDriveId);
      const fileId = await GoogleDriveCacheService.findCacheFile(drive, folderId, sharedDriveId);

      if (!fileId) {
        console.log('📭 No inventory cache file found in Google Drive');
        return null;
      }

      const response = await drive.files.get({
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      });

      // Handle different response data types
      let dataString: string;
      
      if (typeof response.data === 'string') {
        dataString = response.data;
      } else if (response.data instanceof Buffer) {
        dataString = response.data.toString('utf8');
      } else if (response.data && typeof response.data === 'object') {
        // Already parsed JSON - check for expected properties
        const data = response.data as Record<string, unknown>;
        if (data.inventory || data.lastUpdated) {
          // Log what we're loading
          const incomingInventory = data.incomingInventory as Record<string, unknown> | undefined;
          if (incomingInventory && Object.keys(incomingInventory).length > 0) {
            console.log(`✅ Loaded inventory cache from Google Drive (already parsed) with incomingInventory`);
          } else {
            console.log('✅ Loaded inventory cache from Google Drive (already parsed) - no incomingInventory');
          }
          return response.data as T;
        }
        
        // Handle readable streams
        if ('readable' in data && typeof data.read === 'function') {
          const chunks: Buffer[] = [];
          let chunk;
          const readable = data as unknown as { read(): Buffer | null };
          while ((chunk = readable.read()) !== null) {
            chunks.push(chunk);
          }
          if (chunks.length > 0) {
            dataString = Buffer.concat(chunks).toString('utf8');
          } else {
            throw new Error('Empty readable stream');
          }
        } else {
          throw new Error(`Unsupported response data type: ${(data as object).constructor?.name}`);
        }
      } else {
        throw new Error(`Unexpected response data type: ${typeof response.data}`);
      }
      
      const cached = JSON.parse(dataString);
      // Log what we loaded
      if (cached.incomingInventory && Object.keys(cached.incomingInventory).length > 0) {
        console.log(`✅ Loaded inventory cache from Google Drive with incomingInventory`);
      } else {
        console.log('✅ Loaded inventory cache from Google Drive - no incomingInventory');
      }
      return cached as T;

    } catch (error) {
      console.error('❌ Failed to load inventory data from Google Drive:', error);
      return null;
    }
  }
}
