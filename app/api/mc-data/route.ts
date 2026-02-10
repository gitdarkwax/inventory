import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { google } from 'googleapis';

const CACHE_FILE_NAME = 'mc-data.json';

// Initial MC data from user's provided list
const INITIAL_MC_DATA: Record<string, number> = {
  'ES26U-BK': 50,
  'ES26P-BK': 50,
  'LPS26U-BK': 400,
  'LPS26P-BK': 400,
  'SPS26U': 100,
  'SPS26P': 100,
  'EC17M-BK': 50,
  'EC17M-BE': 50,
  'EC17P-BK': 50,
  'EC17P-BE': 50,
  'EC17A-BK': 50,
  'EC17A-BE': 50,
  'EC17-BK': 50,
  'MBC17M-BK': 50,
  'MBC17M-BL': 50,
  'MBC17M-PR': 50,
  'MBC17M-RD': 50,
  'MBC17M-OR': 50,
  'MBC17M-CL': 50,
  'MBC17P-BK': 50,
  'MBC17P-BL': 50,
  'MBC17P-PR': 50,
  'MBC17P-RD': 50,
  'MBC17P-OR': 50,
  'MBC17P-CL': 50,
  'LF-17M-RD': 500,
  'LF-17M-BL': 500,
  'LF-17M-LG': 500,
  'LF-17M-PR': 500,
  'LF-17M-OR': 500,
  'LF-17M-OG': 500,
  'ACU-RD': 1000,
  'ACU-BL': 1000,
  'ACU-LG': 1000,
  'ACU-PR': 1000,
  'ACU-OR': 1000,
  'ACU-OG': 1000,
  'BTN-U-X5': 1000,
  'LP17M': 400,
  'LP17P': 400,
  'LP17A-BK': 400,
  'LP17A-GD': 400,
  'LP17': 400,
  'APDP3-BK': 100,
  'APDP3-WT': 100,
  'APDP3-RD': 100,
  'APDP3-BL': 100,
  'APDP3-PR': 100,
  'APDP3-BE': 100,
  'SP17M': 50,
  'SP17P': 50,
  'SP17A': 50,
  'SP17': 50,
  'EP10XL-BK': 50,
  'EP10P-BK': 50,
  'LPP10P-BK': 300,
  'LPP10XL-BK': 300,
  'WRT25-RD': 200,
  'WRT25-BK': 200,
  'WRT25-OG': 200,
  'WRT25-PR': 200,
  'WRT25-BL': 200,
  'WRT25-WT': 200,
  'EC16M-BK': 50,
  'EC16M-WT': 50,
  'EC16P-BK': 50,
  'EC16P-WT': 50,
  'EC15M-BK': 50,
  'EC15M-WT': 50,
  'EC15P-BK': 50,
  'EC15P-WT': 50,
  'MBC16M-BK': 50,
  'MBC16M-BL': 50,
  'MBC16M-CL': 50,
  'MBC16P-BK': 50,
  'MBC16P-BL': 50,
  'MBC16P-CL': 50,
  'MBC16X-BK': 50,
  'MBC16X-CL': 50,
  'MBC16-BK': 50,
  'MBC16-CL': 50,
  'BTN-16-X4': 1000,
  'ACC16E-BK': 100,
  'ACC16E-WT': 100,
  'ACC16E-RD': 100,
  'ACC16E-LB': 100,
  'ACC16E-LG': 100,
  'ACC16E-PK': 100,
  'ACC16E-YW': 100,
  'ACC16E-OR': 100,
  'SP16M': 100,
  'SP16P': 100,
  'SP16X': 100,
  'SP16': 100,
  'LP16M': 400,
  'LP16X': 400,
  'MBC15M - BKS1': 50,
  'MBC15M - BLS1': 50,
  'MBC15M - DGS1': 50,
  'MBC15M - CLS1': 50,
  'MBC15P - BKS1': 50,
  'MBC15P - BLS1': 50,
  'MBC15P - DGS1': 50,
  'MBC15P - CLS1': 50,
  'MBC15X - BKS1': 50,
  'MBC15X - CLS1': 50,
  'MBC15 - BKS1': 50,
  'MBC15 - CLS1': 50,
  'BTN-15CL-X4': 3000,
  'BTN-15BK-X4': 800,
  'RPTMY20H-X4': 6,
  'RPTMY20H-X5': 6,
  'RPTMY20I-22X4': 6,
  'RPTMY20I-22X5': 6,
  'RPTMY20I-RDX4': 6,
  'RPTMY20I-RDX5': 6,
  'RPTMY20I-WHX4': 6,
  'RPTMY20I-WHX5': 6,
  'RPTMY21U-22X4': 6,
  'RPTMY21U-22X5': 6,
  'RPTMY21U-RDX4': 6,
  'RPTMY21U-RDX5': 6,
  'RPTMY21U-WHX4': 6,
  'RPTMY21U-WHX5': 6,
  'RPTM320U-22X4': 6,
  'RPTM320U-22X5': 6,
  'EP9XL-BK': 50,
  'MBP7P-BKS1': 50,
  'MBP8P-BKS1': 50,
  'MBP6P-BKS1': 50,
  'LPP9XLE-BK': 400,
  'SPP9XL': 100,
  'MBC14M - BKS1': 50,
  'MBC14M - BLS1': 50,
  'MBC14M - DGS1': 50,
  'MBC14M - CLS1': 50,
  'MBC14P - BKS1': 50,
  'MBC14P - BLS1': 50,
  'MBC14P - DGS1': 50,
  'MBC14P - CLS1': 50,
  'MBC14X - BKS1': 50,
  'MBC14X - BLS1': 50,
  'MBC14X - DGS1': 50,
  'MBC14X - CLS1': 50,
  'MBC14 - BKS1': 50,
  'MBC14 - BLS1': 50,
  'MBC14 - DGS1': 50,
  'MBC14 - CLS1': 50,
  'MBS22U-BKS1': 50,
  'MBS22U-BLS1': 50,
  'MBS23U-BKS1': 50,
  'MBS24U-BKS1': 50,
  'ES24U-BK': 50,
  'ES25U-BK': 50,
  'MBS25U-BK': 50,
  'SPS24U': 100,
  'SPS25U': 100,
  'ACS24E-RD': 100,
  'ACS24E-OR': 100,
  'ACS24E-LG': 100,
  'ACS24E-LB': 100,
  'ACS24E-YW': 100,
  'ACS24E-PK': 100,
  'LPS24U-BK': 400,
  'LPS24U-RD': 400,
  'LPS25U-BK': 400,
  'MBS22P-BKS1': 50,
  'MBS22P-BLS1': 50,
  'MBC13M-BKS2 - 6.7': 50,
  'MBC13M-BLS2 - 6.7': 50,
  'MBC13M-DGS2 - 6.7': 50,
  'MBC13M-RDS2 - 6.7': 50,
  'MBC13M-CLS1 - 6.7': 50,
  'MBC13M-BKS2 - OLD': 50,
  'MBC13M-BLS2 - OLD': 50,
  'MBC13M-DGS2 - OLD': 50,
  'MBC13M-RDS2 - OLD': 50,
  'MBC13P-BKS2 - 6.1': 50,
  'MBC13P-BLS2 - 6.1': 50,
  'MBC13P-DGS2 - 6.1': 50,
  'MBC13P-RDS2 - 6.1': 50,
  'MBC13P-CLS1 - 6.1': 50,
  'MBC13P-BKS2 - OLD': 50,
  'MBC13P-BLS2 - OLD': 50,
  'MBC13P-DGS2 - OLD': 50,
  'MBC13P-RDS2 - OLD': 50,
  'MBC13-BKS2 - 6.1': 50,
  'MBC13-BLS2 - 6.1': 50,
  'MBC13-DGS2 - 6.1': 50,
  'MBC13-RDS2 - 6.1': 50,
  'MBC13-CLS1 - 6.1': 50,
  'MBC13N-BKS2 - 5.4': 50,
  'MBC13N-BLS2 - 5.4': 50,
  'MBC13N-DGS2 - 5.4': 50,
  'MBC13N-RDS2 - 5.4': 50,
  'MBC12M-BKMS - 6.7': 50,
  'MBC12M-BLMS - 6.7': 50,
  'MBC12M-DGMS - 6.7': 50,
  'MBC12M-RDMS - 6.7': 50,
  'MBC12M-BKS2 - 6.7': 50,
  'MBC12M-BLS2 - 6.7': 50,
  'MBC12M-DGS2 - 6.7': 50,
  'MBC12M-RDS2 - 6.7': 50,
  'MBC12P-BKMS - 6.1': 50,
  'MBC12P-BLMS - 6.1': 50,
  'MBC12P-DGMS - 6.1': 50,
  'MBC12P-RDMS - 6.1': 50,
  'MBC12P-BKS2 - 6.1': 50,
  'MBC12P-BLS2 - 6.1': 50,
  'MBC12P-DGS2 - 6.1': 50,
  'MBC12P-RDS2 - 6.1': 50,
  'MBC12-BKMS - 5.4': 50,
  'MBC12-BLMS - 5.4': 50,
  'MBC12-DGMS - 5.4': 50,
  'MBC12-RDMS - 5.4': 50,
  'MBC12-BKS2 - 5.4': 50,
  'MBC12-BLS2 - 5.4': 50,
  'MBC12-DGS2 - 5.4': 50,
  'MBC12-RDS2 - 5.4': 50,
  'MBCXIM-BKS2': 50,
  'MBCXIM-BLS2': 50,
  'MBCXIM-DGS2': 50,
  'MBCXIM-RDS2': 50,
  'MBCXI-BKS2': 50,
  'MBCXI-BLS2': 50,
  'MBCXI-DGS2': 50,
  'MBCXI-RDS2': 50,
  'MBCXIR-BKS2': 50,
  'MBCXIR-BLS2': 50,
  'MBCXIR-DGS2': 50,
  'MBCXIR-RDS2': 50,
  'MBCXS-BKS2': 50,
  'MBCXS-BLS2': 50,
  'MBCXS-DGS2': 50,
  'MBCXS-RDS2': 50,
  'MBCXM-BKS2': 50,
  'MBCXM-BLS2': 50,
  'MBCXM-DGS2': 50,
  'MBCXM-RDS2': 50,
  'MBQI': 40,
  'MBPD30-CAR': 350,
  'MBPD20-HOME': 250,
  'MBWLT-SBK': 200,
  'MBWLT-BK': 200,
  'MBWLT-TN': 200,
  'MBHS-BK': 50,
  'MBHS-SV': 50,
  'MBQIML-DGUS': 48,
  'MBQISS-DGUS': 48,
  'TVLQIML-DG': 60,
  'SC12M-CL1': 100,
  'SC12P-CL1': 100,
  'SC12-CL1': 100,
  'SCXSM-CL1': 100,
  'SCXR-CL1': 100,
  'SCXS-CL1': 100,
  'SC13M-CL1': 100,
  'SC13P-CL1': 100,
  'SC13N-CL1': 100,
  'SC14M-CL1': 100,
  'SC14P-CL1': 100,
  'MBST-MBC2': 600,
  'MBT3Y-DG': 90,
  'MBT3YRH-DG': 90,
  'CTC-BKC': 200,
  'MBPD60-CAR': 400,
  'MBHALO-SVUS': 10,
  'ACDC12V3A': 120,
  'WBNDL-SBK': 200,
  'WBNDL-BK': 200,
  'WBNDL-TN': 200,
  'WBNDS-SBK': 200,
  'WBNDS-BK': 200,
  'WBNDS-TN': 200,
  'MBKH-DG': 135,
  'SC15M-CL1': 60,
  'SC15P-CL1': 60,
  'SC15X-CL1': 100,
  'SC15-CL1': 100,
  'SCP8P-CL1': 100,
  'SCTM24-CL': 25,
  'SCTM24-MT': 25,
  'SCTM3Y-CL': 25,
  'SCTM3Y-MT': 25,
  'ADTCT-L': 200,
  'ADT24-L': 200,
  'WSTRP-BK': 500,
  'WSTRP-WT': 500,
  'WSTRP-RD': 500,
  'WSTRP-PR': 500,
  'WSTRP-PK': 500,
};

async function getGoogleDriveClient() {
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

  const authClient = new google.auth.GoogleAuth({
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

  return google.drive({ version: 'v3', auth: authClient });
}

async function findSharedDrive(drive: ReturnType<typeof google.drive>) {
  const response = await drive.drives.list({
    pageSize: 100,
  });

  const sharedDrive = response.data.drives?.find(
    d => d.name === 'ProjectionsVsActual Cache'
  );

  if (!sharedDrive?.id) {
    throw new Error('Shared drive "ProjectionsVsActual Cache" not found');
  }

  return sharedDrive.id;
}

async function findOrCreateFile(drive: ReturnType<typeof google.drive>, driveId: string, fileName: string) {
  // Search for existing file
  const searchResponse = await drive.files.list({
    q: `name='${fileName}' and '${driveId}' in parents and trashed=false`,
    driveId: driveId,
    corpora: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: 'files(id, name)',
  });

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    return searchResponse.data.files[0].id!;
  }

  // Create new file with initial data
  const fileContent = JSON.stringify(INITIAL_MC_DATA, null, 2);
  const file = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/json',
      parents: [driveId],
    },
    media: {
      mimeType: 'application/json',
      body: require('stream').Readable.from([fileContent]),
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  
  return file.data.id!;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const drive = await getGoogleDriveClient();
    const driveId = await findSharedDrive(drive);
    const fileId = await findOrCreateFile(drive, driveId, CACHE_FILE_NAME);
    
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
      supportsAllDrives: true,
    });

    let dataString: string;
    if (typeof response.data === 'string') {
      dataString = response.data;
    } else if (response.data instanceof Buffer) {
      dataString = response.data.toString('utf8');
    } else if (response.data && typeof response.data === 'object') {
      return NextResponse.json(response.data);
    } else {
      throw new Error(`Unexpected response data type: ${typeof response.data}`);
    }

    const mcData = JSON.parse(dataString);
    return NextResponse.json(mcData);
  } catch (error) {
    console.error('Error fetching MC data:', error);
    return NextResponse.json({ error: 'Failed to fetch MC data' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mcData = await request.json();
    const drive = await getGoogleDriveClient();
    const driveId = await findSharedDrive(drive);
    const fileId = await findOrCreateFile(drive, driveId, CACHE_FILE_NAME);

    const fileContent = JSON.stringify(mcData, null, 2);
    await drive.files.update({
      fileId: fileId,
      media: {
        mimeType: 'application/json',
        body: require('stream').Readable.from([fileContent]),
      },
      supportsAllDrives: true,
    });

    return NextResponse.json({ success: true, data: mcData });
  } catch (error) {
    console.error('Error updating MC data:', error);
    return NextResponse.json({ error: 'Failed to update MC data' }, { status: 500 });
  }
}
