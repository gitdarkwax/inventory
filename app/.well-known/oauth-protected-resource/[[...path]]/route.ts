/**
 * OAuth Protected Resource Metadata (RFC 9728) for the Claude connector.
 *
 * Tells Claude which sign-in server (WorkOS AuthKit) issues tokens for
 * /api/mcp. Served at both /.well-known/oauth-protected-resource and
 * /.well-known/oauth-protected-resource/api/mcp, since clients may ask for
 * either form.
 */

import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler';
import { getAuthkitIssuer, getResourceUrl } from '@/lib/mcp/auth';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const issuer = getAuthkitIssuer();
  if (!issuer) {
    return Response.json({ error: 'Connector sign-in is not configured' }, { status: 503 });
  }
  return protectedResourceHandler({ authServerUrls: [issuer], resourceUrl: getResourceUrl() })(request);
}

const corsHandler = metadataCorsOptionsRequestHandler();
export function OPTIONS() {
  return corsHandler();
}
