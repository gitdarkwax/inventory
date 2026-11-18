/**
 * Sign-in for the Claude connector (MCP server at /api/mcp).
 *
 * Claude signs each teammate in through WorkOS AuthKit, which hands Claude an
 * access token (a signed JWT). On every request we:
 *   1. verify the token's signature, issuer and audience against AuthKit,
 *   2. find the person's email (from a JWT template claim, or the WorkOS API),
 *   3. look the email up in the app's own allowlists (ALLOWED_EMAILS /
 *      ALLOWED_EMAILS_READONLY) — the same lists the web app uses.
 *
 * AuthKit only proves who the person is. What they may do is decided here,
 * by the same rules as the web app.
 *
 * Env:
 *   WORKOS_AUTHKIT_DOMAIN  https://<your-subdomain>.authkit.app (the AuthKit issuer)
 *   MCP_RESOURCE_URL       https://inventory.magbak.ai/api/mcp (must match the
 *                          Resource Indicator configured in WorkOS)
 *   WORKOS_API_KEY         optional; used to look up the email when the token
 *                          carries no email claim
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { getUserRole } from '@/lib/auth';

export const DEFAULT_RESOURCE_URL = 'https://inventory.magbak.ai/api/mcp';

export type ConnectorRole = 'write' | 'readonly' | null;

export type ConnectorUser = {
  userId: string;
  email: string | null;
  name: string;
  role: ConnectorRole;
};

export function getAuthkitIssuer(): string | null {
  const raw = process.env.WORKOS_AUTHKIT_DOMAIN?.trim();
  if (!raw) return null;
  const withScheme = raw.startsWith('http') ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

export function getResourceUrl(): string {
  return (process.env.MCP_RESOURCE_URL?.trim() || DEFAULT_RESOURCE_URL).replace(/\/+$/, '');
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksIssuer: string | null = null;

function getJwks(issuer: string) {
  if (!jwks || jwksIssuer !== issuer) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`));
    jwksIssuer = issuer;
  }
  return jwks;
}

type WorkosUser = { email: string; emailVerified: boolean; name: string };

const userCache = new Map<string, { user: WorkosUser; expires: number }>();
const USER_CACHE_MS = 5 * 60 * 1000;

/** Look up a WorkOS user by ID (cached for a few minutes per server instance). */
export async function fetchWorkosUser(
  userId: string,
  apiKey: string | undefined = process.env.WORKOS_API_KEY,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkosUser | null> {
  if (!apiKey) return null;
  const cached = userCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.user;

  const response = await fetchImpl(
    `https://api.workos.com/user_management/users/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok) {
    console.error(`[mcp] WorkOS user lookup failed: ${response.status}`);
    return null;
  }
  const data = (await response.json()) as {
    email?: string;
    email_verified?: boolean;
    first_name?: string | null;
    last_name?: string | null;
  };
  if (!data.email) return null;
  const user: WorkosUser = {
    email: data.email,
    emailVerified: data.email_verified === true,
    name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.email,
  };
  userCache.set(userId, { user, expires: Date.now() + USER_CACHE_MS });
  return user;
}

function emailFromClaims(payload: JWTPayload): string | null {
  for (const key of ['email', 'urn:magbak:email']) {
    const value = payload[key];
    if (typeof value === 'string' && value.includes('@')) return value;
  }
  return null;
}

function nameFromClaims(payload: JWTPayload): string | null {
  for (const key of ['name', 'urn:magbak:name']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Turn verified token claims into a connector user.
 * Prefers the WorkOS API (which says whether the email is verified) when an
 * API key is configured; otherwise uses an email claim from the JWT template.
 */
export async function resolveConnectorUser(
  payload: JWTPayload,
  deps: {
    lookupUser?: (userId: string) => Promise<WorkosUser | null>;
    roleFor?: (email: string) => ConnectorRole;
  } = {},
): Promise<ConnectorUser> {
  const userId = payload.sub ?? '';
  const lookupUser = deps.lookupUser ?? ((id: string) => fetchWorkosUser(id));
  const roleFor = deps.roleFor ?? getUserRole;

  let email: string | null = null;
  let name: string | null = nameFromClaims(payload);

  const apiUser = userId ? await lookupUser(userId) : null;
  if (apiUser) {
    email = apiUser.emailVerified ? apiUser.email : null;
    name = name ?? apiUser.name;
  } else {
    email = emailFromClaims(payload);
  }

  const role = email ? roleFor(email) : null;
  return { userId, email, name: name ?? email ?? 'Unknown', role };
}

/**
 * Verify a bearer token for withMcpAuth. Returns undefined for a missing or
 * invalid token, which makes Claude (re)start sign-in.
 */
export async function verifyConnectorToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const issuer = getAuthkitIssuer();
  if (!issuer) {
    console.error('[mcp] WORKOS_AUTHKIT_DOMAIN is not set; rejecting connector request');
    return undefined;
  }
  const resourceUrl = getResourceUrl();

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(bearerToken, getJwks(issuer), {
      issuer,
      audience: resourceUrl,
    }));
  } catch (error) {
    console.warn('[mcp] token rejected:', error instanceof Error ? error.message : error);
    return undefined;
  }

  // WorkOS issues agent tokens from the same issuer; only people may use this.
  if (payload.sub_profile === 'ai_agent') return undefined;

  const user = await resolveConnectorUser(payload);
  const scope = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];

  return {
    token: bearerToken,
    clientId: typeof payload.client_id === 'string' ? payload.client_id : 'unknown',
    scopes: scope,
    expiresAt: payload.exp,
    resource: new URL(resourceUrl),
    extra: { user },
  };
}

export function connectorUserFrom(authInfo: AuthInfo | undefined): ConnectorUser | null {
  const user = authInfo?.extra?.user as ConnectorUser | undefined;
  return user ?? null;
}
