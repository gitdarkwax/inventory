# Inventory Dashboard

Real-time Shopify inventory tracking and analytics dashboard.

## Features

- 📦 Real-time inventory levels from Shopify
- ⚠️ Low stock alerts and notifications
- 📊 Inventory analytics by category
- 🔔 Slack notifications for stock alerts
- 🔐 Google OAuth authentication with email allowlist

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS 4
- **Auth:** NextAuth.js v5
- **APIs:** Shopify Admin API, Google Drive API, Slack API
- **Language:** TypeScript

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Shopify store with Admin API access
- Google Cloud project with OAuth credentials
- Slack workspace with bot token

### Installation

1. Clone the repository:
   ```bash
   cd /Users/alexbaca/vibe/inventory
   ```

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
| `SLACK_BOT_TOKEN` | Slack bot OAuth token |
| `SLACK_CHANNEL_ID` | Slack channel ID for notifications |
| `ALLOWED_EMAILS` | Comma-separated list of allowed email addresses |
| `AUTH_SECRET` | NextAuth secret (generate with `openssl rand -base64 32`) |
| `AUTH_URL` | Application URL (e.g., `http://localhost:3000`) |

## Project Structure

```
inventory/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   └── auth/          # NextAuth handlers
│   ├── auth/              # Auth pages (signin, error)
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── lib/                   # Shared utilities
│   ├── auth.ts           # NextAuth configuration
│   ├── constants.ts      # App constants and categories
│   ├── google-drive-cache.ts  # Google Drive caching
│   ├── shopify.ts        # Shopify API client
│   └── slack.ts          # Slack notifications
├── public/               # Static assets
└── package.json
```

## Deployment

Deploy to Vercel:

```bash
vercel
```

Make sure to set all environment variables in your Vercel project settings.

## Related Projects

- [projections-v2](../projections-v2) - Sales analytics dashboard

## License

Private - Internal use only

