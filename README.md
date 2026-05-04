# BLG Manager Dashboard

Internal agency dashboard for BestLyfe Group DMMs (Jarvis Gatlin, Jan Feterman, Adriana Zendan) to monitor client revenue health at a glance.

## Stack

- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Express.js
- **Database**: SQLite (via Drizzle ORM) — swap to Postgres by implementing the `IStorage` interface
- **AI**: Claude (Anthropic) — RAG-powered chat scoped to live dashboard data + uploaded documents

## Features

- Revenue health dashboard: MTD, MoM trend, YoY trend, churn risk per client
- Manager-level filtering (each DMM sees only their clients)
- Last Touch logging — click to log today or pick a date
- Agency Analytics deep-link per client
- AI chat (Claude) with live data context + trusted document RAG
- Platform integrations: ERS, Inflatable Office, Google Ads, GA4, Meta Ads

## Local Development

```bash
npm install
npm run dev
```

App runs at http://localhost:5000

## Production Build

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

## Railway Deployment

1. Connect this repo in Railway → New Project → Deploy from GitHub
2. Set environment variables (see below)
3. Add a volume mounted at `/app/uploads` for document storage
4. SQLite DB (`blg-dashboard.db`) persists at project root — mount a volume or swap to Postgres for production

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 5000) |
| `NODE_ENV` | Set to `production` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token |
| `IO_API_BASE_URL` | Inflatable Office API base URL (when available) |

All API keys (Google OAuth, Meta token, Claude, Agency Analytics) are stored securely in the database via Settings → API Integrations. No need to set them as env vars.

## Adding a New CRM Connector

1. Create `server/connectors/yourcrmname.ts` — export a `fetchYourCRMMetrics()` function
2. Add the connector to the sync loop in `server/routes.ts` under `POST /api/sync`
3. Add per-client credential fields to `shared/schema.ts` and run the migration in `server/storage.ts`
4. Add the fields to the client edit form in `client/src/pages/Clients.tsx`
5. Push to GitHub — Railway redeploys automatically
