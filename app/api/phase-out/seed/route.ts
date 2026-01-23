import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { PhaseOutService } from '@/lib/phase-out-skus';

export const dynamic = 'force-dynamic';

// One-time seed endpoint - can be removed after use
const SEED_SKUS = [
  'ACS24E-YW',
  'MBC14-BKS1',
  'MBC16P-CL',
  'MBC16P-BL',
  'MBC14M-CLS1',
  'BTN-16-X4',
  'EC15M-WT',
  'EC16M-WT',
  'EC16P-WT',
  'MBC15-CLS1',
  'MBC16-CL',
  'MBC15M-BLS1',
  'MBC16X-BK',
  'MBC15-BKS1',
  'SC15-CL1',
  'SP16',
  'ACC16E-OR',
  'ACS24E-LB',
  'ACS24E-LG',
  'ACS24E-OR',
  'ACS24E-RD',
  'LP16X',
  'MBC15P-DGS1',
  'MBC15X-BKS1',
  'RPTMY20I-RDX4',
  'RPTMY21U-WTX4',
  'RPTMY21U-RDX4',
  'RPTM320U-22X4',
  'MBC14-CLS1',
  'MBC14-BLS1',
  'MBC14-DGS1',
  'LPS25U-RD',
];

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results: { sku: string; status: string }[] = [];

    for (const sku of SEED_SKUS) {
      try {
        await PhaseOutService.addSKU(
          sku,
          session.user.name || 'System',
          session.user.email || 'system@inventory.app'
        );
        results.push({ sku, status: 'added' });
      } catch (error) {
        results.push({ sku, status: `error: ${error}` });
      }
    }

    return NextResponse.json({
      message: `Seeded ${results.filter(r => r.status === 'added').length} SKUs`,
      results,
    });
  } catch (error) {
    console.error('Error seeding phase out SKUs:', error);
    return NextResponse.json(
      { error: 'Failed to seed phase out SKUs' },
      { status: 500 }
    );
  }
}
