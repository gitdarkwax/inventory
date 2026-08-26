/**
 * Shared API actor resolution for human Google sessions and machine agents.
 *
 * Accepts either:
 * - an existing NextAuth Google session cookie, or
 * - `Authorization: Bearer <AGENT_API_KEY>` (server env only; never NEXT_PUBLIC_)
 *
 * Agent callers are full-write and attributed via optional `X-Agent-Name`
 * (fallback "Agent") plus synthetic email agent@inventory.magbak.ai.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auth, canWrite } from './auth';

export const AGENT_EMAIL = 'agent@inventory.magbak.ai';
export const AGENT_NAME_HEADER = 'x-agent-name';
export const DEFAULT_AGENT_NAME = 'Agent';

export type ApiActor = {
  name: string;
  email: string;
  role: 'write' | 'readonly';
  source: 'session' | 'agent';
};

export type ApiActorSuccess = { ok: true; actor: ApiActor };
export type ApiActorFailure = { ok: false; response: NextResponse };
export type ApiActorResult = ApiActorSuccess | ApiActorFailure;

export type RequireApiActorOptions = {
  /** Require write role (ALLOWED_EMAILS). Agent bearer is always write. */
  write?: boolean;
  writeError?: string;
};

const DEFAULT_WRITE_ERROR =
  'Read-only access. You do not have permission to perform this action.';

export function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    if (leftBuf.length > 0) {
      timingSafeEqual(leftBuf, leftBuf);
    }
    return false;
  }
  if (leftBuf.length === 0) {
    return true;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

export function sanitizeAgentName(headerValue: string | null | undefined): string {
  const trimmed = headerValue?.trim() ?? '';
  if (!trimmed) return DEFAULT_AGENT_NAME;
  return trimmed.replace(/[\r\n]/g, '').slice(0, 80) || DEFAULT_AGENT_NAME;
}

/**
 * Resolve an agent actor from a bearer token.
 * Fail closed when AGENT_API_KEY is unset/empty or the token is missing/wrong.
 */
export function resolveAgentActor(
  authorization: string | null | undefined,
  agentNameHeader: string | null | undefined,
  apiKey: string | undefined = process.env.AGENT_API_KEY,
): ApiActor | null {
  const expected = apiKey?.trim() ?? '';
  if (!expected) {
    return null;
  }

  if (!authorization) {
    return null;
  }

  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return null;
  }

  if (!timingSafeStringEqual(token, expected)) {
    return null;
  }

  return {
    name: sanitizeAgentName(agentNameHeader),
    email: AGENT_EMAIL,
    role: 'write',
    source: 'agent',
  };
}

/**
 * Accept either a Google session or a valid AGENT_API_KEY bearer token.
 * Invalid/missing bearer does not block a valid session.
 */
export async function requireApiActor(
  request: Request,
  options: RequireApiActorOptions = {},
): Promise<ApiActorResult> {
  const agent = resolveAgentActor(
    request.headers.get('authorization'),
    request.headers.get(AGENT_NAME_HEADER),
  );
  if (agent) {
    return { ok: true, actor: agent };
  }

  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (options.write && !canWrite(session.user.email)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: options.writeError ?? DEFAULT_WRITE_ERROR },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    actor: {
      name: session.user.name || 'Unknown',
      email: session.user.email || 'unknown@example.com',
      role: canWrite(session.user.email) ? 'write' : 'readonly',
      source: 'session',
    },
  };
}
