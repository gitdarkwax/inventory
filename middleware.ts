/**
 * Redirect Vercel deployment URL to custom domain (inventory.magbak.ai).
 * Both URLs work, but vercel.app traffic is redirected to the main domain.
 *
 * IMPORTANT: Auth routes (/auth/*, /api/auth/*) are excluded from redirect.
 * OAuth PKCE cookies are domain-specific - if the callback is redirected
 * to a different domain, the cookie is lost and sign-in fails.
 * AUTH_URL must be set to https://inventory.magbak.ai so the flow stays on the custom domain.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const MAIN_DOMAIN = 'inventory.magbak.ai';

export function middleware(request: NextRequest) {
  const host = request.nextUrl.hostname;
  const pathname = request.nextUrl.pathname;

  // Never redirect auth routes - PKCE cookies are domain-specific
  if (pathname.startsWith('/auth') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Only redirect vercel.app domains to the main domain
  if (host.endsWith('.vercel.app')) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.host = MAIN_DOMAIN;
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
