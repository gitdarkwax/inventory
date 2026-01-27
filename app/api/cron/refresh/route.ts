/**
 * Cron API Route - Hourly Auto Refresh
 * This route is called by Vercel Cron to refresh inventory data every hour
 * 
 * IMPORTANT: This simply calls the main /api/refresh endpoint to ensure
 * identical behavior between manual and automatic refreshes.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request from Vercel
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (!cronSecret) {
      console.error('❌ CRON_SECRET not configured');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }
    
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.error('❌ Invalid cron authorization');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🕐 Starting hourly cron refresh (calling main refresh endpoint)...');

    // Get the base URL for internal API call
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';

    // Call the main refresh endpoint with cron secret for auth
    const refreshResponse = await fetch(`${baseUrl}/api/refresh`, {
      method: 'GET',
      headers: {
        'x-auto-refresh': 'true',
        'x-cron-secret': cronSecret,
      },
    });

    const refreshResult = await refreshResponse.json();

    if (!refreshResponse.ok) {
      console.error('❌ Main refresh endpoint failed:', refreshResult);
      return NextResponse.json(
        { error: 'Refresh failed', details: refreshResult.error },
        { status: refreshResponse.status }
      );
    }

    console.log(`✅ Hourly cron refresh complete via main endpoint`);

    return NextResponse.json({
      success: true,
      message: 'Hourly refresh completed (via main endpoint)',
      ...refreshResult,
    });
  } catch (error) {
    console.error('❌ Cron refresh failed:', error);
    return NextResponse.json(
      { error: 'Cron refresh failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
