# Claude connector

Teammates can ask Claude about inventory from their own Claude accounts. This release is **look-up only**: no tool writes to Drive, Shopify or Slack.

- Endpoint: `https://inventory.magbak.ai/api/mcp` (MCP over Streamable HTTP, via `mcp-handler`)
- Sign-in: WorkOS AuthKit issues the access token. On every request the app checks the person's email against `ALLOWED_EMAILS` / `ALLOWED_EMAILS_READONLY`, the same lists the web app uses. People on neither list get a refusal.
- Audit: every tool call is logged in the Vercel runtime logs as `[mcp] <tool> by <email> (<role>) via Claude`.
- Code: `app/api/mcp/route.ts`, `app/.well-known/oauth-protected-resource/[[...path]]/route.ts`, `lib/mcp/`. Tests: `lib/mcp/auth.test.ts`, `tests/mcp-connector.test.ts`.

## Tools

| Tool | Answers |
|---|---|
| `find_skus` | Search SKUs by code, product or variant |
| `get_sku_stock` | Available, on hand and committed by location; incoming per location; units pending on production orders; sales per day; runway |
| `low_stock` | SKUs under N days of runway (21-day average, the same basis as the low-stock alerts), per location or combined |
| `get_incoming` | Units in transit per destination and SKU |
| `list_transfers` / `get_transfer` | Transfers by status, SKU or destination; one transfer in full |
| `list_production_orders` / `get_production_order` | POs by status, SKU or vendor; one PO in full |
| `get_sku_notes` | Team comment, phase-out and hidden flags |

Stock comes from the hourly Shopify snapshot, and every stock answer says when that snapshot was taken.

## Setup

### WorkOS (once, shared with the Production Tracker connector)

These were done on 2026-11-18 in the **Staging** environment (AuthKit domain `https://humorous-comic-97-staging.authkit.app`). Staging uses WorkOS's demo Google app, so the Google screen names WorkOS. Production needs MagBak's own Google credentials and its own AuthKit domain.

1. Authentication → Providers: **Google** on. Microsoft, GitHub and Apple off.
2. Authentication → Methods: **Email + Password** off, so Google is the only way in.
3. Connect → Configuration: **Client ID Metadata Document** and **Dynamic Client Registration** on.
4. Connect → Configuration → MCP resource indicators: `https://inventory.magbak.ai/api/mcp`.
5. Authentication → Features → JWT template:
   ```
   {"urn:magbak:email": {{ user.email }}, "urn:magbak:email_verified": {{ user.email_verified }}, "urn:magbak:name": {{ user.name }}}
   ```
   The app only accepts an email when `urn:magbak:email_verified` is `true`. With this template in place, no WorkOS API key is needed.

### Vercel environment variables (Production)

| Name | Value |
|---|---|
| `WORKOS_AUTHKIT_DOMAIN` | `https://<subdomain>.authkit.app`, the `issuer` from `https://<subdomain>.authkit.app/.well-known/oauth-authorization-server` |
| `MCP_RESOURCE_URL` | `https://inventory.magbak.ai/api/mcp` (this is also the default) |
| `WORKOS_API_KEY` | Not needed while the JWT template is set. If set, the app looks up the email through the WorkOS API instead |

Until `WORKOS_AUTHKIT_DOMAIN` is set, `/api/mcp` rejects every request. Nothing else in the app changes either way.

### Claude (Team or Enterprise)

1. An Owner opens Organization settings → Connectors → Add → Custom → Web and enters `https://inventory.magbak.ai/api/mcp`.
2. Teammates open Settings → Connectors, turn on the connector and sign in with Google.
