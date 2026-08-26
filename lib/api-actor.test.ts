import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth, canWrite } from './auth';
import {
  AGENT_EMAIL,
  DEFAULT_AGENT_NAME,
  requireApiActor,
  resolveAgentActor,
  sanitizeAgentName,
  timingSafeStringEqual,
} from './api-actor';

vi.mock('./auth', () => ({
  auth: vi.fn(),
  canWrite: vi.fn(),
}));

const mockedAuth = vi.mocked(auth);
const mockedCanWrite = vi.mocked(canWrite);

const TEST_KEY = 'test-agent-key-abcdefghijklmnopqrstuvwxyz';

function makeRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/test', { headers });
}

describe('timingSafeStringEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for same-length unequal strings', () => {
    expect(timingSafeStringEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(timingSafeStringEqual('abc', 'ab')).toBe(false);
    expect(timingSafeStringEqual('', 'x')).toBe(false);
  });
});

describe('sanitizeAgentName', () => {
  it('falls back to Agent when missing or blank', () => {
    expect(sanitizeAgentName(null)).toBe(DEFAULT_AGENT_NAME);
    expect(sanitizeAgentName('   ')).toBe(DEFAULT_AGENT_NAME);
  });

  it('trims and strips newlines', () => {
    expect(sanitizeAgentName('  inventory-bot\n ')).toBe('inventory-bot');
  });
});

describe('resolveAgentActor', () => {
  it('rejects a missing token', () => {
    expect(resolveAgentActor(null, null, TEST_KEY)).toBeNull();
    expect(resolveAgentActor(undefined, null, TEST_KEY)).toBeNull();
    expect(resolveAgentActor('Basic abc', null, TEST_KEY)).toBeNull();
  });

  it('rejects an empty bearer token', () => {
    expect(resolveAgentActor('Bearer ', null, TEST_KEY)).toBeNull();
    expect(resolveAgentActor('Bearer    ', null, TEST_KEY)).toBeNull();
  });

  it('rejects a wrong token', () => {
    expect(resolveAgentActor(`Bearer not-${TEST_KEY}`, null, TEST_KEY)).toBeNull();
  });

  it('fails closed when AGENT_API_KEY is unset or empty', () => {
    expect(resolveAgentActor(`Bearer ${TEST_KEY}`, null, undefined)).toBeNull();
    expect(resolveAgentActor(`Bearer ${TEST_KEY}`, null, '')).toBeNull();
    expect(resolveAgentActor(`Bearer ${TEST_KEY}`, null, '   ')).toBeNull();
    expect(resolveAgentActor('Bearer ', null, '')).toBeNull();
  });

  it('accepts a valid token with default agent name', () => {
    expect(resolveAgentActor(`Bearer ${TEST_KEY}`, null, TEST_KEY)).toEqual({
      name: DEFAULT_AGENT_NAME,
      email: AGENT_EMAIL,
      role: 'write',
      source: 'agent',
    });
  });

  it('accepts a valid token and uses X-Agent-Name', () => {
    expect(resolveAgentActor(`Bearer ${TEST_KEY}`, 'po-bot', TEST_KEY)).toEqual({
      name: 'po-bot',
      email: AGENT_EMAIL,
      role: 'write',
      source: 'agent',
    });
  });
});

describe('requireApiActor', () => {
  const previousKey = process.env.AGENT_API_KEY;

  afterEach(() => {
    process.env.AGENT_API_KEY = previousKey;
    vi.resetAllMocks();
  });

  it('rejects a missing token when there is no session', async () => {
    process.env.AGENT_API_KEY = TEST_KEY;
    mockedAuth.mockResolvedValue(null);

    const result = await requireApiActor(makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      await expect(result.response.json()).resolves.toEqual({ error: 'Unauthorized' });
    }
  });

  it('rejects a wrong token when there is no session', async () => {
    process.env.AGENT_API_KEY = TEST_KEY;
    mockedAuth.mockResolvedValue(null);

    const result = await requireApiActor(
      makeRequest({ authorization: 'Bearer totally-wrong' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('accepts a valid token without a session', async () => {
    process.env.AGENT_API_KEY = TEST_KEY;
    mockedAuth.mockResolvedValue(null);

    const result = await requireApiActor(
      makeRequest({
        authorization: `Bearer ${TEST_KEY}`,
        'x-agent-name': 'ops-agent',
      }),
    );
    expect(result).toEqual({
      ok: true,
      actor: {
        name: 'ops-agent',
        email: AGENT_EMAIL,
        role: 'write',
        source: 'agent',
      },
    });
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it('fails closed when AGENT_API_KEY is unset even if a bearer is sent', async () => {
    delete process.env.AGENT_API_KEY;
    mockedAuth.mockResolvedValue(null);

    const result = await requireApiActor(
      makeRequest({ authorization: `Bearer ${TEST_KEY}` }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it('keeps Google session behavior when no bearer is sent', async () => {
    process.env.AGENT_API_KEY = TEST_KEY;
    mockedAuth.mockResolvedValue({
      user: { name: 'Ada Lovelace', email: 'ada@magbak.com' },
      expires: '2099-01-01',
    });
    mockedCanWrite.mockReturnValue(true);

    const result = await requireApiActor(makeRequest());
    expect(result).toEqual({
      ok: true,
      actor: {
        name: 'Ada Lovelace',
        email: 'ada@magbak.com',
        role: 'write',
        source: 'session',
      },
    });
  });

  it('does not block a valid session when bearer is wrong', async () => {
    process.env.AGENT_API_KEY = TEST_KEY;
    mockedAuth.mockResolvedValue({
      user: { name: 'Ada Lovelace', email: 'ada@magbak.com' },
      expires: '2099-01-01',
    });
    mockedCanWrite.mockReturnValue(false);

    const result = await requireApiActor(
      makeRequest({ authorization: 'Bearer wrong-key' }),
    );
    expect(result).toEqual({
      ok: true,
      actor: {
        name: 'Ada Lovelace',
        email: 'ada@magbak.com',
        role: 'readonly',
        source: 'session',
      },
    });
  });

  it('rejects readonly sessions when write is required', async () => {
    process.env.AGENT_API_KEY = TEST_KEY;
    mockedAuth.mockResolvedValue({
      user: { name: 'Read Only', email: 'ro@magbak.com' },
      expires: '2099-01-01',
    });
    mockedCanWrite.mockReturnValue(false);

    const result = await requireApiActor(makeRequest(), {
      write: true,
      writeError: 'Read-only access. You do not have permission to create transfers.',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toEqual({
        error: 'Read-only access. You do not have permission to create transfers.',
      });
    }
  });

  it('grants write to a valid agent token even when write is required', async () => {
    process.env.AGENT_API_KEY = TEST_KEY;
    mockedAuth.mockResolvedValue(null);

    const result = await requireApiActor(
      makeRequest({ authorization: `Bearer ${TEST_KEY}` }),
      { write: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.role).toBe('write');
      expect(result.actor.source).toBe('agent');
    }
  });
});
