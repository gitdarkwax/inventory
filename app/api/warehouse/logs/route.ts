/**
 * Warehouse Submission Logs API
 * Stores and retrieves submission logs from Google Drive
 * Supports multiple locations: LA Office, LA Warehouse, China
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

const SHARED_DRIVE_NAME = 'ProjectionsVsActual Cache';

// Get logs file name for a specific location
const getLogsFileName = (location: string) => {
  const sanitizedLocation = location.replace(/\s/g, '-').toLowerCase();
  return `warehouse-logs-${sanitizedLocation}.json`;
};

interface SubmissionLog {
  timestamp: string;
  submittedBy: string;
  summary: {
    totalSKUs: number;
    discrepancies: number;
    totalDifference: number;
  };
  updates: Array<{
    sku: string;
    previousOnHand: number;
    newQuantity: number;
  }>;
  result: {
    total: number;
    success: number;
    failed: number;
  };
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

// GET - Retrieve logs for a location
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const location = searchParams.get('location') || 'LA Office';
    const logsFileName = getLogsFileName(location);

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);
    const fileId = await findFile(drive, folderId, sharedDriveId, logsFileName);

    if (!fileId) {
      return NextResponse.json({ logs: [] });
    }

    const response = await drive.files.get({
      fileId,
      alt: 'media',
      supportsAllDrives: true,
    });

    let logs: SubmissionLog[] = [];
    if (typeof response.data === 'string') {
      logs = JSON.parse(response.data);
    } else if (response.data && typeof response.data === 'object') {
      logs = response.data as SubmissionLog[];
    }

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Failed to load logs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load logs' },
      { status: 500 }
    );
  }
}

// POST - Add new log entry for a location
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { log, location = 'LA Office' } = await request.json();
    if (!log) {
      return NextResponse.json({ error: 'No log entry provided' }, { status: 400 });
    }

    const logsFileName = getLogsFileName(location);

    const drive = await getDriveClient();
    const sharedDriveId = await findSharedDrive(drive);
    const folderId = await findOrCreateFolder(drive, sharedDriveId);
    const fileId = await findFile(drive, folderId, sharedDriveId, logsFileName);

    // Load existing logs
    let logs: SubmissionLog[] = [];
    if (fileId) {
      const response = await drive.files.get({
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      });
      if (typeof response.data === 'string') {
        logs = JSON.parse(response.data);
      } else if (Array.isArray(response.data)) {
        logs = response.data;
      }
    }

    // Add new log at beginning (with location info)
    logs.unshift({ ...log, location });
    
    // Keep last 500 logs
    logs = logs.slice(0, 500);

    const fileContent = JSON.stringify(logs, null, 2);
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
          name: logsFileName,
          parents: [folderId],
        },
        media: {
          mimeType: 'application/json',
          body: Readable.from([fileContent]),
        },
        supportsAllDrives: true,
      });
    }

    return NextResponse.json({ success: true, totalLogs: logs.length });
  } catch (error) {
    console.error('Failed to save log:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save log' },
      { status: 500 }
    );
  }
}
