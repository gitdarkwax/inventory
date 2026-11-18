/**
 * Claude connector end to end: real tokens signed with a test key, the real
 * /api/mcp handler, and the real tools — with Drive and Shopify mocked.
 * Nothing here reaches WorkOS, Google Drive, Shopify or Slack.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

const ISSUER = 'https://magbak-test.authkit.app';
const RESOURCE = 'https://inventory.magbak.ai/api/mcp';

const roles = vi.hoisted(() => new Map<string, 'write' | 'readonly'>());
vi.mock('@/lib/auth', () => ({
  getUserRole: (email: string | null | undefined) => (email ? roles.get(email.toLowerCase()) ?? null : null),
}));

const data = vi.hoisted(() => ({
  cache: null as unknown,
  transfers: [] as unknown[],
  orders: [] as unknown[],
  writes: [] as string[],
  driveReads: [] as string[],
}));

vi.mock('@/lib/inventory-cache', () => ({
  InventoryCacheService: class {
    loadCache = async () => {
      data.driveReads.push('inventory-cache');
      return data.cache;
    };
    saveCache = async () => data.writes.push('inventory-cache');
  },
}));
vi.mock('@/lib/transfers', () => ({
  TransfersService: {
    loadTransfers: async () => ({ transfers: data.transfers, lastUpdated: '' }),
    saveTransfers: async () => data.writes.push('transfers'),
  },
}));
vi.mock('@/lib/production-orders', () => ({
  ProductionOrdersService: {
    loadOrders: async () => ({ orders: data.orders, lastUpdated: '' }),
    saveOrders: async () => data.writes.push('orders'),
    getPendingQuantitiesBySku: async () => new Map([['MBC16-BK', 300]]),
  },
}));
vi.mock('@/lib/hidden-skus', () => ({
  HiddenSkusService: { getHiddenSKUs: async () => ({ skus: [{ sku: 'OLD-1' }], lastUpdated: '' }) },
}));
vi.mock('@/lib/phase-out-skus', () => ({
  PhaseOutService: { getPhaseOutSKUs: async () => ({ skus: [], lastUpdated: '' }) },
}));
vi.mock('@/lib/sku-comments', () => ({
  SkuCommentsService: {
    getComments: async () => {
      data.driveReads.push('sku-comments');
      return {
        lastUpdated: '',
        comments: {
          'MBC16-BK': { sku: 'MBC16-BK', comment: 'Reorder before Black Friday', updatedAt: '2026-11-01', updatedBy: 'Alex', updatedByEmail: 'a@x' },
        },
      };
    },
  },
}));

let privateKey: CryptoKey;
let publicJwk: JWK;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', ISSUER);
  vi.stubEnv('MCP_RESOURCE_URL', RESOURCE);
  vi.stubEnv('WORKOS_API_KEY', '');
  // Serve the test JWKS where AuthKit would; refuse anything else.
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${ISSUER}/oauth2/jwks`) return Response.json({ keys: [publicJwk] });
    throw new Error(`unexpected network call in test: ${url} ${init?.method ?? ''}`);
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.stubGlobal('fetch', realFetch);
});

beforeEach(async () => {
  const limits = await import('@/lib/mcp/limits');
  limits.clearLoadCache();
  limits.connectorRateLimiter.reset();
  data.driveReads = [];
  roles.clear();
  roles.set('writer@magbak.com', 'write');
  roles.set('reader@magbak.com', 'readonly');
  data.writes = [];
  data.cache = {
    lastUpdated: new Date(Date.now() - 20 * 60000).toISOString(),
    refreshedBy: 'hourly auto refresh',
    inventory: {
      totalSKUs: 2,
      totalUnits: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      locations: ['LA Office', 'DTLA WH'],
      locationIds: {},
      inventory: [
        {
          sku: 'MBC16-BK', productTitle: 'iPhone 16 Case', variantTitle: 'Black',
          locations: { 'LA Office': 40, 'DTLA WH': 60 }, totalAvailable: 100, inTransit: 0, transferDetails: [],
        },
        {
          sku: 'OLD-1', productTitle: 'Old thing', variantTitle: '',
          locations: { 'LA Office': 1, 'DTLA WH': 0 }, totalAvailable: 1, inTransit: 0, transferDetails: [],
        },
      ],
      locationDetails: {
        'LA Office': [{ sku: 'MBC16-BK', productTitle: '', variantTitle: '', inventoryItemId: '1', available: 40, onHand: 45, committed: 5, incoming: 0, inboundAir: 0, inboundSea: 0, transferNotes: [], airTransfers: [], seaTransfers: [] }],
        'DTLA WH': [],
      },
    },
    forecasting: {
      forecasting: [
        { sku: 'MBC16-BK', productName: '', avgDaily7d: 6, avgDaily21d: 5, avgDaily90d: 4, avgDailyLastYear30d: 3 },
        { sku: 'OLD-1', productName: '', avgDaily7d: 1, avgDaily21d: 1, avgDaily90d: 1, avgDailyLastYear30d: 1 },
      ],
    },
    incomingInventory: {
      'LA Office': {
        'MBC16-BK': { inboundAir: 200, inboundSea: 0, airTransfers: [{ transferId: 'T0042', quantity: 200, note: null, createdAt: '', expectedArrivalAt: '2026-11-25' }], seaTransfers: [] },
      },
    },
  };
  data.transfers = [
    { id: 'T0042', origin: 'China', destination: 'LA Office', transferType: 'Air Express', items: [{ sku: 'MBC16-BK', quantity: 200 }], notes: '', status: 'in_transit', createdBy: 'Alex', createdByEmail: '', createdAt: '2026-11-15T00:00:00Z', updatedAt: '' },
    { id: 'T0041', origin: 'DTLA WH', destination: 'LA Office', transferType: 'Immediate', items: [{ sku: 'OLD-1', quantity: 1 }], notes: '', status: 'delivered', createdBy: 'Alex', createdByEmail: '', createdAt: '2026-11-10T00:00:00Z', updatedAt: '' },
  ];
  data.orders = [
    { id: 'po-1', poNumber: 'PO-1001', items: [{ sku: 'MBC16-BK', quantity: 500, receivedQuantity: 200 }], notes: '', vendor: 'Acme Factory', status: 'partial', paymentPercentPaid: 50, createdBy: 'Alex', createdByEmail: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '' },
  ];
});

/**
 * A token shaped like WorkOS issues it with the MagBak JWT template:
 * `email` here becomes the template's urn:magbak:email claim, verified.
 */
async function token(
  { email, ...claims }: Record<string, unknown>,
  opts: { issuer?: string; audience?: string; expiresIn?: string; verified?: boolean } = {},
) {
  return new SignJWT({
    ...claims,
    ...(email ? { 'urn:magbak:email': email, 'urn:magbak:email_verified': opts.verified ?? true } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? RESOURCE)
    .setSubject(String(claims.sub ?? 'user_1'))
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m')
    .sign(privateKey);
}

async function rpc(method: string, params: unknown, bearer?: string) {
  const { POST } = await import('@/app/api/mcp/route');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
    host: 'inventory.magbak.ai',
    'x-forwarded-proto': 'https',
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await POST(
    new Request(RESOURCE, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }),
  );
  const text = await response.text();
  let body: { result?: Record<string, unknown>; error?: unknown } | null = null;
  const jsonText = text.trim().startsWith('{')
    ? text
    : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop();
  if (jsonText) body = JSON.parse(jsonText);
  return { response, body };
}

async function callTool(name: string, args: Record<string, unknown>, bearer: string) {
  const { body } = await rpc('tools/call', { name, arguments: args }, bearer);
  const result = body?.result as { isError?: boolean; content: Array<{ text: string }> };
  const text = result.content[0].text;
  return { isError: !!result.isError, text, json: result.isError ? null : JSON.parse(text) };
}

describe('sign-in gate', () => {
  it('answers 401 with a pointer to the sign-in metadata when there is no token', async () => {
    const { response } = await rpc('tools/list', {});
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://inventory.magbak.ai/.well-known/oauth-protected-resource"',
    );
  });

  it('rejects a token from a different issuer', async () => {
    const t = await token({ email: 'writer@magbak.com' }, { issuer: 'https://evil.example.com' });
    expect((await rpc('tools/list', {}, t)).response.status).toBe(401);
  });

  it('rejects a token meant for a different resource', async () => {
    const t = await token({ email: 'writer@magbak.com' }, { audience: 'https://production.magbak.ai/api/mcp' });
    expect((await rpc('tools/list', {}, t)).response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const t = await token({ email: 'writer@magbak.com' }, { expiresIn: '-1m' });
    expect((await rpc('tools/list', {}, t)).response.status).toBe(401);
  });

  it('rejects WorkOS agent tokens', async () => {
    const t = await token({ email: 'writer@magbak.com', sub_profile: 'ai_agent' });
    expect((await rpc('tools/list', {}, t)).response.status).toBe(401);
  });
});

describe('tools', () => {
  it('lists only look-up tools, all marked read-only', async () => {
    const t = await token({ email: 'reader@magbak.com' });
    const { response, body } = await rpc('tools/list', {}, t);
    expect(response.status).toBe(200);
    const tools = (body?.result?.tools ?? []) as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
    expect(tools.map((x) => x.name).sort()).toEqual([
      'find_skus', 'get_incoming', 'get_production_order', 'get_sku_notes', 'get_sku_stock',
      'get_transfer', 'list_production_orders', 'list_transfers', 'low_stock',
    ]);
    expect(tools.every((x) => x.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('refuses data to a signed-in person who is not on the allowlists', async () => {
    const t = await token({ email: 'stranger@gmail.com' });
    const r = await callTool('get_sku_stock', { sku: 'MBC16-BK' }, t);
    expect(r.isError).toBe(true);
    expect(r.text).toContain("not on the inventory app's access list");
  });

  it('refuses data when the email in the token is not verified', async () => {
    const t = await token({ email: 'writer@magbak.com' }, { verified: false });
    const r = await callTool('get_sku_stock', { sku: 'MBC16-BK' }, t);
    expect(r.isError).toBe(true);
  });

  it('shows stock by location with incoming, pending POs and runway', async () => {
    const t = await token({ email: 'reader@magbak.com' });
    const { json } = await callTool('get_sku_stock', { sku: 'mbc16-bk' }, t);
    expect(json.totalAvailable).toBe(100);
    expect(json.pendingFromProductionOrders).toBe(300);
    expect(json.runwayDaysAllLocations).toBe(20);
    const la = json.locations.find((l: { location: string }) => l.location === 'LA Office');
    expect(la).toMatchObject({ available: 40, onHand: 45, committed: 5 });
    expect(la.incoming.inboundAir).toBe(200);
    expect(la.incoming.shipments[0]).toEqual({ transfer: 'T0042', quantity: 200, expectedArrival: '2026-11-25' });
    expect(json.freshness.minutesAgo).toBe(20);
  });

  it('finds SKUs by product words', async () => {
    const t = await token({ email: 'reader@magbak.com' });
    const { json } = await callTool('find_skus', { query: 'iphone black' }, t);
    expect(json.results.map((r: { sku: string }) => r.sku)).toEqual(['MBC16-BK']);
  });

  it('lists low stock without hidden SKUs unless asked', async () => {
    const t = await token({ email: 'reader@magbak.com' });
    const normal = await callTool('low_stock', { maxDays: 30 }, t);
    expect(normal.json.results.map((r: { sku: string }) => r.sku)).toEqual(['MBC16-BK']);
    const all = await callTool('low_stock', { maxDays: 30, includeHidden: true }, t);
    expect(all.json.results.map((r: { sku: string }) => r.sku)).toEqual(['OLD-1', 'MBC16-BK']);
  });

  it('lists and opens transfers and production orders', async () => {
    const t = await token({ email: 'reader@magbak.com' });
    const transfers = await callTool('list_transfers', { status: 'in_transit' }, t);
    expect(transfers.json.results.map((r: { id: string }) => r.id)).toEqual(['T0042']);
    const transfer = await callTool('get_transfer', { id: 't0042' }, t);
    expect(transfer.json.units).toBe(200);
    const po = await callTool('get_production_order', { id: 'PO-1001' }, t);
    expect(po.json).toMatchObject({ vendor: 'Acme Factory', unitsOrdered: 500, unitsReceived: 200, paymentPercentPaid: 50 });
    expect(po.json.items[0].pending).toBe(300);
  });

  it('reads SKU notes', async () => {
    const t = await token({ email: 'reader@magbak.com' });
    const { json } = await callTool('get_sku_notes', { sku: 'MBC16-BK' }, t);
    expect(json.comment.text).toBe('Reorder before Black Friday');
  });

  it('never writes anything', async () => {
    const t = await token({ email: 'writer@magbak.com' });
    for (const [name, args] of [
      ['find_skus', { query: 'case' }],
      ['get_sku_stock', { sku: 'MBC16-BK' }],
      ['low_stock', {}],
      ['get_incoming', {}],
      ['list_transfers', {}],
      ['list_production_orders', {}],
    ] as const) {
      await callTool(name, args, t);
    }
    expect(data.writes).toEqual([]);
  });
});

describe('Drive and rate limits', () => {
  it('reads the inventory snapshot from Drive once for a burst of calls', async () => {
    const t = await token({ email: 'reader@magbak.com' });
    await callTool('get_sku_stock', { sku: 'MBC16-BK' }, t);
    await callTool('find_skus', { query: 'iphone' }, t);
    await callTool('low_stock', {}, t);
    expect(data.driveReads.filter((r) => r === 'inventory-cache')).toHaveLength(1);
  });

  it('refuses a person after 30 calls in a minute, without blocking others', async () => {
    const reader = await token({ email: 'reader@magbak.com' });
    for (let i = 0; i < 30; i++) {
      expect((await callTool('get_incoming', {}, reader)).isError).toBe(false);
    }
    const refused = await callTool('get_incoming', {}, reader);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Too many inventory look-ups');
    const writer = await token({ email: 'writer@magbak.com' });
    expect((await callTool('get_incoming', {}, writer)).isError).toBe(false);
  });
});

describe('sign-in metadata', () => {
  it('points Claude at WorkOS AuthKit for this resource', async () => {
    const { GET } = await import('@/app/.well-known/oauth-protected-resource/[[...path]]/route');
    const response = GET(new Request('https://inventory.magbak.ai/.well-known/oauth-protected-resource'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resource).toBe(RESOURCE);
    expect(body.authorization_servers).toEqual([ISSUER]);
  });
});
