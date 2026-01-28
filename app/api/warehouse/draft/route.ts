/**
 * Warehouse Draft API
 * Stores and retrieves shared draft inventory counts from Google Drive
 * Single shared draft per location - auto-merges when anyone saves
 * Tracks who counted each SKU for attribution
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

const SHARED_DRIVE_NAME = 'ProjectionsVsActual Cache';

// Get draft file name for a specific location (single shared draft)
const getDraftFileName = (location: string) => {
  const sanitizedLocation = location.replace(/\s/g, '-').toLowerCase();
  return `warehouse-draft-${sanitizedLocation}.json`;
};

// Structure for tracking who counted each SKU
interface SkuCount {
  value: number;
  countedBy: string;
  countedAt: string;
}

interface SharedDraftData {
  counts: Record<string, SkuCount | null>;
  lastSavedAt: string;
  lastSavedBy: string;
  contributors: string[]; // List of people who have contributed
}

// Simple counts format for frontend
interface SimpleCounts {
  [sku: string]: number | null;
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

async function loadExistingDraft(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  sharedDriveId: string,
  fileName: string
): Promise<SharedDraftData | null> {
  const fileId = await findFile(drive, folderId, sharedDriveId, fileName);
  if (!fileId) return null;

  const response = await drive.files.get({
    fileId,
    alt: 'media',
    supportsAllDrives: true,
  });

  let draft: SharedDraftData | null = null;
  if (typeof response.data === 'string') {
    draft = JSON.parse(response.data);
  } else if (response.data && typeof response.data === 'object') {
    draft = response.data as SharedDraftData;
  }

  return draft;
}

// GET - Retrieve shared draft for a location (merged counts from all contributors)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const location = searchParams.get('location') || 'LA Office';
    const userName = session.user.name || 'Unknown';

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);
    const draftFileName = getDraftFileName(location);

    const draft = await loadExistingDraft(drive, folderId, sharedDriveId, draftFileName);

    if (!draft) {
      return NextResponse.json({ 
        draft: null,
        currentUser: userName,
      });
    }

    // Convert to simple counts format for frontend
    const simpleCounts: SimpleCounts = {};
    const countDetails: Record<string, { countedBy: string; countedAt: string }> = {};
    
    for (const [sku, data] of Object.entries(draft.counts)) {
      if (data !== null) {
        simpleCounts[sku] = data.value;
        countDetails[sku] = { countedBy: data.countedBy, countedAt: data.countedAt };
      }
    }

    return NextResponse.json({ 
      draft: {
        counts: simpleCounts,
        countDetails, // Who counted each SKU
        savedAt: draft.lastSavedAt,
        savedBy: draft.lastSavedBy,
        contributors: draft.contributors || [],
      },
      currentUser: userName,
    });
  } catch (error) {
    console.error('Failed to load draft:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load draft' },
      { status: 500 }
    );
  }
}

// POST - Save and merge draft for a location
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
    const now = new Date().toISOString();
    const draftFileName = getDraftFileName(location);

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);
    
    // Load existing draft to merge with
    const existingDraft = await loadExistingDraft(drive, folderId, sharedDriveId, draftFileName);
    
    // Start with existing counts or empty
    const mergedCounts: Record<string, SkuCount | null> = existingDraft?.counts || {};
    const contributors = new Set<string>(existingDraft?.contributors || []);
    contributors.add(userName);

    // Merge incoming counts
    for (const [sku, value] of Object.entries(counts as SimpleCounts)) {
      if (value !== null) {
        // User is setting a count for this SKU
        mergedCounts[sku] = {
          value: value as number,
          countedBy: userName,
          countedAt: now,
        };
      } else if (mergedCounts[sku] && mergedCounts[sku]?.countedBy === userName) {
        // User is clearing their own count
        mergedCounts[sku] = null;
      }
      // If value is null but SKU was counted by someone else, keep their count
    }

    const newDraft: SharedDraftData = {
      counts: mergedCounts,
      lastSavedAt: now,
      lastSavedBy: userName,
      contributors: Array.from(contributors),
    };

    const fileContent = JSON.stringify(newDraft, null, 2);
    const { Readable } = require('stream');

    const fileId = await findFile(drive, folderId, sharedDriveId, draftFileName);

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

    // Return merged counts in simple format
    const simpleCounts: SimpleCounts = {};
    const countDetails: Record<string, { countedBy: string; countedAt: string }> = {};
    
    for (const [sku, data] of Object.entries(mergedCounts)) {
      if (data !== null) {
        simpleCounts[sku] = data.value;
        countDetails[sku] = { countedBy: data.countedBy, countedAt: data.countedAt };
      }
    }

    const skuCount = Object.values(mergedCounts).filter(v => v !== null).length;

    return NextResponse.json({ 
      success: true, 
      savedAt: now,
      savedBy: userName,
      skuCount,
      mergedCounts: simpleCounts,
      countDetails,
      contributors: Array.from(contributors),
    });
  } catch (error) {
    console.error('Failed to save draft:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save draft' },
      { status: 500 }
    );
  }
}

// DELETE - Delete draft for a location (clears for everyone)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const location = searchParams.get('location') || 'LA Office';
    const draftFileName = getDraftFileName(location);
    const sanitizedLocation = location.replace(/\s/g, '-').toLowerCase();

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);
    
    let deletedCount = 0;

    // Delete the main shared draft file
    const fileId = await findFile(drive, folderId, sharedDriveId, draftFileName);
    if (fileId) {
      await drive.files.delete({
        fileId,
        supportsAllDrives: true,
      });
      deletedCount++;
    }

    // Also clean up any old per-user draft files from previous implementation
    const oldDraftPattern = `warehouse-draft-${sanitizedLocation}-`;
    const oldDraftsResponse = await drive.files.list({
      q: `parents='${folderId}' and name contains '${oldDraftPattern}' and mimeType='application/json'`,
      driveId: sharedDriveId,
      corpora: 'drive',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'files(id, name)',
    });

    if (oldDraftsResponse.data.files) {
      for (const file of oldDraftsResponse.data.files) {
        try {
          await drive.files.delete({
            fileId: file.id!,
            supportsAllDrives: true,
          });
          deletedCount++;
        } catch (err) {
          console.error(`Failed to delete old draft ${file.name}:`, err);
        }
      }
    }

    return NextResponse.json({ success: true, deletedCount });
  } catch (error) {
    console.error('Failed to delete draft:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete draft' },
      { status: 500 }
    );
  }
}
