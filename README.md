# ResiQ CRM

ResiQ CRM is a full-stack CRM platform for property-tech consulting workflows, including:

- contacts, deals, activities, reminders
- proposals, invoices, time tracking, calendar booking
- help desk and client portal
- role-based access and audit logs
- outbound automation for email + LinkedIn with human approval

## Current Outbound Capabilities

Outbound automation is now implemented under `/api/outbound` and in the UI at `/outbound-automation`.

- CSV lead import with dedupe and scoring
- draft generation for email and LinkedIn
- approval-required send flow
- daily send limits (email + LinkedIn)
- suppression hard blocks
- campaign runs and campaign members
- event and audit export (CSV/JSON)

## Tech Stack

- Frontend: React, Vite, Tailwind, Axios
- Backend: Node.js, Express, PostgreSQL, Redis, Bull
- Auth: JWT
- Integrations: Google (Gmail/Calendar), Twilio, Stripe

## Repository Layout

```text
resiq-crm/
  client/                 React frontend
  server/                 Express API
  database/
    schema.sql            Base schema
    migrations/           Incremental migrations (002+)
  scripts/
    outbound-smoke-test.js
  docker-compose.yml      Local infra (Postgres/Redis)
  docker-compose.prod.yml Production stack
```

## Local Quick Start

1. Create `.env` from example.

```bash
cp .env.example .env
```

2. Set required values in `.env`:

- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY` (must be exactly 32 bytes)

3. Install dependencies and run migrations.

```bash
npm run install:all
npm run migrate
```

4. Start the app.

```bash
npm run dev
```

5. Open:

- frontend: `http://localhost:5173`
- API health: `http://localhost:5000/api/health`
- outbound UI: `http://localhost:5173/outbound-automation`

## Smoke Test

Run outbound end-to-end smoke coverage:

```bash
npm run test:outbound-smoke
```

This validates import, dedupe, draft generation, approval gates, send/completion flows, campaign creation, suppression checks, and export endpoints.

## Environment Notes

- Keep `ALLOW_SYNTHETIC_LEADS=false` in production.
- Daily limits default to:
  - `OUTBOUND_DAILY_EMAIL_SEND_LIMIT=40`
  - `OUTBOUND_DAILY_LINKEDIN_SEND_LIMIT=50`

## Production Docs

- Setup guide: [SETUP.md](./SETUP.md)
- Deployment runbook: [DEPLOYMENT.md](./DEPLOYMENT.md)
- Release checklist: [PRODUCTION_READINESS_CHECKLIST.md](./PRODUCTION_READINESS_CHECKLIST.md)
- Outbound implementation plan/status: [OUTBOUND_AUTOMATION_DEVELOPMENT_DOC.md](./OUTBOUND_AUTOMATION_DEVELOPMENT_DOC.md)
