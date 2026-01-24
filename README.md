# MagBak Inventory Management Dashboard v1.0

Real-time Shopify inventory tracking, forecasting, and production planning dashboard.

## Features

### 📋 LA Planning
- SKU-level inventory visibility across all locations (LA Office, DTLA WH, ShipBob, China WH)
- Burn rate calculations (7-day, 21-day, 90-day averages)
- Runway calculations with air and sea shipment tracking
- Ship type recommendations based on inventory levels
- Production status tracking with active PO awareness
- Multi-select product filtering
- Export to Excel

### 📦 PO Tracker
- Manual production order management with Shopify PO# integration
- Delivery logging with partial delivery support
- SKU search with autocomplete
- Activity log tracking for all order changes
- Date range filtering
- Export to Excel

### 📊 Inventory
- Real-time inventory levels from Shopify (products tagged "inventoried")
- Location-specific views with on-hand, available, committed, incoming quantities
- In-transit tracking from Shopify transfers (air/sea tagged)
- Product group filtering
- List and grouped view modes
- Export to Excel

### 📈 Forecasting
- Sales velocity analysis with multiple time periods (7d, 21d, 90d, last year 30d)
- Days of stock calculations
- Run-out date projections
- Category and location filtering
- By Period and By Metric view layouts
- Export to Excel

### 🔄 Auto-Refresh
- Hourly server-side cron job for automatic data refresh
- Manual refresh with user attribution
- Google Drive cache for persistent data storage

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS 4
- **Auth:** NextAuth.js v5 (Google OAuth)
- **APIs:** 
  - Shopify Admin REST API (2024-10)
  - Shopify Admin GraphQL API (2026-01) for transfers
  - ShopifyQL for sales data
  - Google Drive API for cache storage
- **Language:** TypeScript
- **Deployment:** Vercel with Cron Jobs

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Shopify store with Admin API access
- Google Cloud project with OAuth and Service Account credentials
- Google Drive shared drive named "ProjectionsVsActual Cache"

### Installation

1. Clone the repository

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

4. Fill in your environment variables in `.env`

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_SHOP_DOMAIN` | Your Shopify store domain (e.g., `store.myshopify.com`) |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API access token |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google service account email for Drive access |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Google service account private key |
| `GOOGLE_PROJECT_ID` | Google Cloud project ID |
| `ALLOWED_EMAILS` | Comma-separated list of allowed email addresses |
| `AUTH_SECRET` | NextAuth secret (generate with `openssl rand -base64 32`) |
| `AUTH_URL` | Application URL (e.g., `http://localhost:3000`) |
| `CRON_SECRET` | Secret for Vercel cron job authentication |

## Project Structure

```
inventory/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── auth/          # NextAuth handlers
│   │   ├── cron/refresh/  # Hourly cron endpoint
│   │   ├── forecasting/   # Forecasting data endpoint
│   │   ├── inventory/     # Inventory data endpoint
│   │   ├── phase-out/     # Phase-out SKUs management
│   │   ├── production-orders/  # PO Tracker CRUD
│   │   └── refresh/       # Manual refresh endpoint
│   ├── auth/              # Auth pages (signin, error)
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/
│   └── Dashboard.tsx      # Main dashboard component
├── lib/                   # Shared utilities
│   ├── auth.ts           # NextAuth configuration
│   ├── constants.ts      # App constants and categories
│   ├── google-drive-cache.ts  # Google Drive caching
│   ├── inventory-cache.ts    # Cache service wrapper
│   ├── phase-out-skus.ts     # Phase-out SKU management
│   ├── production-orders.ts  # Production orders service
│   ├── shopify.ts        # Shopify REST API client
│   ├── shopify-graphql-transfers.ts  # GraphQL transfer service
│   └── shopifyql.ts      # ShopifyQL queries
├── vercel.json           # Vercel cron configuration
└── package.json
```

## Deployment

Deploy to Vercel:

```bash
vercel
```

Make sure to:
1. Set all environment variables in your Vercel project settings
2. The `CRON_SECRET` will be auto-generated by Vercel for cron jobs

## License

Private - Internal use only
