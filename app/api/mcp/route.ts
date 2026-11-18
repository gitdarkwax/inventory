/**
 * Claude connector endpoint (MCP over Streamable HTTP).
 *
 * Teammates add https://inventory.magbak.ai/api/mcp as a custom connector in
 * Claude and sign in through WorkOS AuthKit. Every request must carry a valid
 * AuthKit access token; tools then check the person against the app's own
 * allowlists. See lib/mcp/auth.ts and lib/mcp/server.ts.
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { getResourceUrl, verifyConnectorToken } from '@/lib/mcp/auth';
import { registerInventoryTools } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const mcpHandler = createMcpHandler(
  (server) => {
    registerInventoryTools(server);
  },
  {
    serverInfo: { name: 'magbak-inventory', version: '1.0.0' },
    instructions:
      'MagBak inventory: stock by SKU and location, low stock, incoming shipments, transfers and production orders. ' +
      'Stock comes from an hourly Shopify snapshot; mention the refresh time when it matters. ' +
      'This connector is look-up only.',
  },
);

const handler = withMcpAuth(mcpHandler, verifyConnectorToken, {
  required: true,
  resourceUrl: getResourceUrl(),
});

export { handler as GET, handler as POST, handler as DELETE };
