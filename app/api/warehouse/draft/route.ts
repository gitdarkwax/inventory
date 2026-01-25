/**
 * Warehouse Draft API
 * Stores and retrieves draft inventory counts from Google Drive
 * Supports multiple locations: LA Office, LA Warehouse, China
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

const SHARED_DRIVE_NAME = 'ProjectionsVsActual Cache';

// Get draft file name for a specific location
const getDraftFileName = (location: string) => {
  const sanitizedLocation = location.replace(/\s/g, '-').toLowerCase();
  return `warehouse-draft-${sanitizedLocation}.json`;
};

interface DraftData {
  counts: Record<string, number | null>;
  savedAt: string;
  savedBy: string;
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

// GET - Retrieve draft for a location
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const location = searchParams.get('location') || 'LA Office';
    const draftFileName = getDraftFileName(location);

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);
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

// POST - Save draft for a location
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

    const draftFileName = getDraftFileName(location);

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);
    const fileId = await findFile(drive, folderId, sharedDriveId, draftFileName);

    const draft: DraftData = {
      counts,
      savedAt: new Date().toISOString(),
      savedBy: session.user.name || 'Unknown',
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

// DELETE - Delete draft for a location (after successful submission)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const location = searchParams.get('location') || 'LA Office';
    const draftFileName = getDraftFileName(location);

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);
    const fileId = await findFile(drive, folderId, sharedDriveId, draftFileName);

    if (fileId) {
      await drive.files.delete({
        fileId,
        supportsAllDrives: true,
      });
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
