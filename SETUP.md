# ResiQ CRM Setup Guide

This guide covers local setup for development and pre-production validation.

## 1. Prerequisites

- Node.js 20+ recommended
- PostgreSQL 15+ (or Docker)
- Redis 7+ (optional but recommended for queue-backed features)

## 2. Configure Environment

Create `.env`:

```bash
cp .env.example .env
```

Minimum required values:

```env
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://resiq:resiq@localhost:5432/resiq_crm
JWT_SECRET=replace-with-random-secret
ENCRYPTION_KEY=12345678901234567890123456789012
API_URL=http://localhost:5000
CLIENT_PORTAL_URL=http://localhost:5173
ALLOW_SYNTHETIC_LEADS=false
```

Important:

- `ENCRYPTION_KEY` must be exactly 32 bytes.
- Keep `ALLOW_SYNTHETIC_LEADS=false` unless explicitly testing synthetic lead behavior.

## 3. Install Dependencies

```bash
npm run install:all
```

## 4. Database Setup

### Option A: Local PostgreSQL

Create database/user and set `DATABASE_URL` accordingly.

### Option B: Docker Infra

```bash
docker compose up -d postgres redis
```

If using default docker-compose values, Postgres is on `localhost:5434`.
Set:

```env
DATABASE_URL=postgresql://resiq:resiq@localhost:5434/resiq_crm
```

## 5. Run Migrations

```bash
npm run migrate
```

The migration runner applies `database/schema.sql` baseline logic and all `database/migrations/*.sql` files in order.

## 6. Start Development

```bash
npm run dev
```

URLs:

- app: `http://localhost:5173`
- API health: `http://localhost:5000/api/health`
- outbound UI: `http://localhost:5173/outbound-automation`

## 7. Validate With Smoke Test

```bash
npm run test:outbound-smoke
```

Expected: a final JSON output with `"ok": true`.

## 8. Common Issues

### `.env` missing or `DATABASE_URL` missing

Create `.env` from `.env.example` and set `DATABASE_URL`.

### `ENCRYPTION_KEY must be exactly 32 bytes`

Set `ENCRYPTION_KEY` to a 32-byte value.

### Postgres auth errors

Confirm credentials in `DATABASE_URL` match the running database.

### Redis unavailable

Some queue-backed features degrade; start Redis to remove warnings.
