import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ getUserRole: () => null }));

import { fetchWorkosUser, getAuthkitIssuer, resolveConnectorUser, verifyConnectorToken } from './auth';

const roles = (map: Record<string, 'write' | 'readonly'>) => (email: string) => map[email.toLowerCase()] ?? null;

describe('resolveConnectorUser', () => {
  it('uses the verified WorkOS email and the app allowlist role', async () => {
    const user = await resolveConnectorUser(
      { sub: 'user_1' },
      {
        lookupUser: async () => ({ email: 'Writer@magbak.com', emailVerified: true, name: 'Wri Ter' }),
        roleFor: roles({ 'writer@magbak.com': 'write' }),
      },
    );
    expect(user).toEqual({ userId: 'user_1', email: 'Writer@magbak.com', name: 'Wri Ter', role: 'write' });
  });

  it('gives no role when the WorkOS email is not verified', async () => {
    const user = await resolveConnectorUser(
      { sub: 'user_1', email: 'writer@magbak.com' },
      {
        lookupUser: async () => ({ email: 'writer@magbak.com', emailVerified: false, name: 'x' }),
        roleFor: roles({ 'writer@magbak.com': 'write' }),
      },
    );
    expect(user.email).toBeNull();
    expect(user.role).toBeNull();
  });

  it('falls back to an email claim from the JWT template when there is no API lookup', async () => {
    const user = await resolveConnectorUser(
      { sub: 'user_2', 'urn:magbak:email': 'reader@magbak.com' },
      { lookupUser: async () => null, roleFor: roles({ 'reader@magbak.com': 'readonly' }) },
    );
    expect(user.role).toBe('readonly');
  });

  it('gives no role to someone who is not on either list', async () => {
    const user = await resolveConnectorUser(
      { sub: 'user_3', email: 'stranger@gmail.com' },
      { lookupUser: async () => null, roleFor: roles({}) },
    );
    expect(user.email).toBe('stranger@gmail.com');
    expect(user.role).toBeNull();
  });
});

describe('fetchWorkosUser', () => {
  it('returns null without an API key and never calls WorkOS', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchWorkosUser('user_x', undefined, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads email, verification and name from the WorkOS user', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ email: 'a@magbak.com', email_verified: true, first_name: 'A', last_name: 'B' }),
    );
    const user = await fetchWorkosUser('user_y', 'sk_test', fetchImpl as unknown as typeof fetch);
    expect(user).toEqual({ email: 'a@magbak.com', emailVerified: true, name: 'A B' });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.workos.com/user_management/users/user_y', {
      headers: { Authorization: 'Bearer sk_test' },
    });
  });

  it('returns null when WorkOS answers with an error', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    expect(await fetchWorkosUser('user_z', 'sk_test', fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});

describe('verifyConnectorToken', () => {
  it('rejects a request with no token', async () => {
    expect(await verifyConnectorToken(new Request('http://x'), undefined)).toBeUndefined();
  });

  it('rejects every token when the AuthKit domain is not configured', async () => {
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', '');
    expect(await verifyConnectorToken(new Request('http://x'), 'abc.def.ghi')).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('rejects a token that is not a valid JWT', async () => {
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', 'https://example.authkit.app');
    expect(await verifyConnectorToken(new Request('http://x'), 'not-a-jwt')).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe('getAuthkitIssuer', () => {
  it('adds https:// and strips a trailing slash', () => {
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', 'magbak.authkit.app/');
    expect(getAuthkitIssuer()).toBe('https://magbak.authkit.app');
    vi.unstubAllEnvs();
  });
});
