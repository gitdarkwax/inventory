/**
 * Warehouse Draft API
 * Stores and retrieves draft inventory counts from Google Drive
 * Supports multiple locations: LA Office, LA Warehouse, China
 * Supports per-person drafts for multi-person counting
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

const SHARED_DRIVE_NAME = 'ProjectionsVsActual Cache';

// Get draft file name for a specific location and user
const getDraftFileName = (location: string, userName?: string) => {
  const sanitizedLocation = location.replace(/\s/g, '-').toLowerCase();
  if (userName) {
    const sanitizedUser = userName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return `warehouse-draft-${sanitizedLocation}-${sanitizedUser}.json`;
  }
  return `warehouse-draft-${sanitizedLocation}.json`;
};

// Get pattern to match all drafts for a location
const getDraftPattern = (location: string) => {
  const sanitizedLocation = location.replace(/\s/g, '-').toLowerCase();
  return `warehouse-draft-${sanitizedLocation}`;
};

interface DraftData {
  counts: Record<string, number | null>;
  savedAt: string;
  savedBy: string;
}

export interface DraftListItem {
  fileName: string;
  savedBy: string;
  savedAt: string;
  skuCount: number;
}

async function getDriveClient() {
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
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
}

async function findSharedDrive(drive: ReturnType<typeof google.drive>): Promise<string> {
  const response = await drive.drives.list();
  const sharedDrive = response.data.drives?.find((d) => d.name === SHARED_DRIVE_NAME);
  if (!sharedDrive) {
    throw new Error(`Shared drive '${SHARED_DRIVE_NAME}' not found`);
  }
  return sharedDrive.id!;
}

async function findOrCreateFolder(
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

async function findFile(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  sharedDriveId: string,
  fileName: string
): Promise<string | null> {
  const response = await drive.files.list({
    q: `parents='${folderId}' and name='${fileName}'`,
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
}

// GET - Retrieve draft for a location or list all drafts
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const location = searchParams.get('location') || 'LA Office';
    const listAll = searchParams.get('list') === 'true';
    const specificFileName = searchParams.get('fileName'); // For fetching a specific draft to merge
    const userName = session.user.name || 'Unknown';

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);

    // Fetch a specific draft by filename (for merging)
    if (specificFileName) {
      const fileId = await findFile(drive, folderId, sharedDriveId, specificFileName);

      if (!fileId) {
        return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
      }

      const response = await drive.files.get({
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      });

      let draft: DraftData | null = null;
      if (typeof response.data === 'string') {
        draft = JSON.parse(response.data);
      } else if (response.data && typeof response.data === 'object') {
        draft = response.data as DraftData;
      }

      return NextResponse.json({ draft, fileName: specificFileName });
    }

    // List all drafts for this location
    if (listAll) {
      const pattern = getDraftPattern(location);
      const response = await drive.files.list({
        q: `parents='${folderId}' and name contains '${pattern}' and mimeType='application/json'`,
        driveId: sharedDriveId,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
      });

      const drafts: DraftListItem[] = [];
      
      if (response.data.files) {
        for (const file of response.data.files) {
          try {
            const fileResponse = await drive.files.get({
              fileId: file.id!,
              alt: 'media',
              supportsAllDrives: true,
            });

            let draftData: DraftData | null = null;
            if (typeof fileResponse.data === 'string') {
              draftData = JSON.parse(fileResponse.data);
            } else if (fileResponse.data && typeof fileResponse.data === 'object') {
              draftData = fileResponse.data as DraftData;
            }

            if (draftData) {
              drafts.push({
                fileName: file.name!,
                savedBy: draftData.savedBy,
                savedAt: draftData.savedAt,
                skuCount: Object.keys(draftData.counts).filter(k => draftData!.counts[k] !== null).length,
              });
            }
          } catch (err) {
            console.error(`Failed to read draft ${file.name}:`, err);
          }
        }
      }

      // Sort by savedAt descending (newest first)
      drafts.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

      return NextResponse.json({ drafts, currentUser: userName });
    }

    // Get current user's draft for this location
    const draftFileName = getDraftFileName(location, userName);
    const fileId = await findFile(drive, folderId, sharedDriveId, draftFileName);

    if (!fileId) {
      return NextResponse.json({ draft: null });
    }

    const response = await drive.files.get({
      fileId,
      alt: 'media',
      supportsAllDrives: true,
    });

    let draft: DraftData | null = null;
    if (typeof response.data === 'string') {
      draft = JSON.parse(response.data);
    } else if (response.data && typeof response.data === 'object') {
      draft = response.data as DraftData;
    }

    return NextResponse.json({ draft });
  } catch (error) {
    console.error('Failed to load draft:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load draft' },
      { status: 500 }
    );
  }
}

// POST - Save draft for a location (per-user draft)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { counts, location = 'LA Office' } = await request.json();
    if (!counts) {
      return NextResponse.json({ error: 'No counts provided' }, { status: 400 });
    }

    const userName = session.user.name || 'Unknown';
    const draftFileName = getDraftFileName(location, userName);

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);
    const fileId = await findFile(drive, folderId, sharedDriveId, draftFileName);

    const draft: DraftData = {
      counts,
      savedAt: new Date().toISOString(),
      savedBy: userName,
    };

    const fileContent = JSON.stringify(draft, null, 2);
    const { Readable } = require('stream');

    if (fileId) {
      await drive.files.update({
        fileId,
        media: {
          mimeType: 'application/json',
          body: Readable.from([fileContent]),
        },
        supportsAllDrives: true,
      });
    } else {
      await drive.files.create({
        requestBody: {
          name: draftFileName,
          parents: [folderId],
        },
        media: {
          mimeType: 'application/json',
          body: Readable.from([fileContent]),
        },
        supportsAllDrives: true,
      });
    }

    return NextResponse.json({ 
      success: true, 
      savedAt: draft.savedAt,
      savedBy: draft.savedBy,
      skuCount: Object.keys(counts).filter(k => counts[k] !== null).length 
    });
  } catch (error) {
    console.error('Failed to save draft:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save draft' },
      { status: 500 }
    );
  }
}

// DELETE - Delete draft for a location (per-user or all)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const location = searchParams.get('location') || 'LA Office';
    const deleteAll = searchParams.get('all') === 'true';
    const userName = session.user.name || 'Unknown';

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);

    if (deleteAll) {
      // Delete all drafts for this location (used after successful submission)
      const pattern = getDraftPattern(location);
      const response = await drive.files.list({
        q: `parents='${folderId}' and name contains '${pattern}' and mimeType='application/json'`,
        driveId: sharedDriveId,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
      });

      if (response.data.files) {
        for (const file of response.data.files) {
          try {
            await drive.files.delete({
              fileId: file.id!,
              supportsAllDrives: true,
            });
          } catch (err) {
            console.error(`Failed to delete draft ${file.name}:`, err);
          }
        }
      }
    } else {
      // Delete only current user's draft
      const draftFileName = getDraftFileName(location, userName);
      const fileId = await findFile(drive, folderId, sharedDriveId, draftFileName);

      if (fileId) {
        await drive.files.delete({
          fileId,
          supportsAllDrives: true,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete draft:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete draft' },
      { status: 500 }
    );
  }
}
