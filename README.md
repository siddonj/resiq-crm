# ResiQ CRM

A full-featured CRM platform for managing contacts, deals, proposals, invoices, and client communications — built with React, Node.js/Express, and PostgreSQL.

---

## Features

| Module | Highlights |
|--------|-----------|
| **Contacts & Pipeline** | Contact management, Kanban deal pipeline, activity logging |
| **Dashboard** | Sales analytics, pipeline summary, workflow metrics, due reminders |
| **Workflows** | Visual workflow builder with triggers (deal stage, contact created) and actions |
| **Proposals** | Section-based builder, pricing table, e-signature, PDF download |
| **Invoices** | Line items (qty/rate/tax/discount), Stripe payment link, PDF download, auto overdue reminders |
| **Time Tracking** | Manual log + live start/stop timer, billable flag, convert to invoice |
| **Calendar** | Month/week view, Google Calendar OAuth sync, public scheduling page (`/book/:slug`) |
| **Reminders** | Due-date reminders linked to contacts and deals |
| **Teams** | Team creation and membership management |
| **RBAC** | Four roles: admin, manager, user, viewer |
| **Audit Logs** | Full action history across all entities |
| **Resource Sharing** | Share contacts/deals between users |
| **Gmail Integration** | OAuth-connected email timeline per contact |
| **Settings & CSV Export** | User profile, notification prefs, export any list |
| **Engagement Tracking** | ✨ *NEW* Pixel-based open tracking for proposals/invoices, real-time engagement timeline |
| **Support Tickets** | ✨ *NEW* Help Desk with Kanban board, client portal, real-time WebSocket updates |
| **Reddit Lead Finder** | ✨ *NEW* AI-powered lead discovery from Reddit discussions using Claude MCP, relevance scoring, auto-qualification |

---

## Tech Stack

**Frontend**
- React 18 + React Router v6
- Vite
- Tailwind CSS
- Axios

**Backend**
- Node.js + Express
- PostgreSQL (via `pg`)
- Redis + Bull (workflow queue, email sync worker)
- JWT authentication
- Google APIs (Gmail, Calendar)

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis (optional — needed for workflows and Gmail sync)

### Quick Start (5 minutes)

```bash
# 1. Install all dependencies and run migrations
node setup.js

# 2. Edit .env with your configuration
# Required: DATABASE_URL, SMTP settings for email notifications

# 3. Start development servers
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:5000
- Help Desk: http://localhost:5173/help-desk (real-time WebSocket updates)
- Client Portal: http://localhost:5173/client/tickets (ticket submission)

---

### Manual Setup Steps

#### 1. Install dependencies

```bash
npm run install:all
```

#### 2. Set up the database

Create a PostgreSQL database and user:

```sql
CREATE USER resiq WITH PASSWORD 'resiq_dev';
CREATE DATABASE resiq_crm OWNER resiq;
GRANT ALL PRIVILEGES ON DATABASE resiq_crm TO resiq;
```

Run all migrations automatically:

```bash
npm run migrate
```

Or manually apply migrations one at a time:

```bash
psql -U resiq -d resiq_crm -f database/migrations/001-initial.sql
psql -U resiq -d resiq_crm -f database/migrations/002-add-rbac-teams.sql
# ... (all other migrations)
psql -U resiq -d resiq_crm -f database/migrations/013-add-support-tickets.sql
```

#### 3. Configure environment

Copy and edit `.env`:

```env
PORT=5000
DATABASE_URL=postgresql://resiq:resiq_dev@localhost:5432/resiq_crm
JWT_SECRET=change_me_in_production
ENCRYPTION_KEY=exactly-32-chars-pad-pad-pad-pad-

# Email notifications (Phase 20 — Support Tickets)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@example.com

# Optional — Redis (workflows + email sync)
REDIS_URL=redis://localhost:6379

# Optional — Gmail OAuth
GMAIL_CLIENT_ID=your_client_id
GMAIL_CLIENT_SECRET=your_client_secret
API_URL=http://localhost:5000

# Optional — Google Calendar OAuth
GCAL_CLIENT_ID=your_client_id
GCAL_CLIENT_SECRET=your_client_secret
```

#### 4. Start development servers

```bash
npm run dev
```

---

## Docker (infrastructure only)

Start PostgreSQL and Redis via Docker Compose:

```bash
docker-compose up -d
```

This starts Postgres on port `5434` and Redis on `6379`. Update `DATABASE_URL` in `server/.env` accordingly.

---

## Google Integrations

### Gmail

1. Create an OAuth 2.0 client in Google Cloud Console
2. Add `http://localhost:5000/api/integrations/gmail/callback` as an authorised redirect URI
3. Enable the Gmail API
4. Add `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` to `server/.env`
5. Connect from **Settings → Gmail**

### Google Calendar

1. Enable the Google Calendar API on the same (or a new) OAuth client
2. Add `http://localhost:5000/api/integrations/gcal/callback` as an authorised redirect URI
3. Add `GCAL_CLIENT_ID` / `GCAL_CLIENT_SECRET` to `server/.env` (or reuse Gmail credentials)
4. Connect from **Calendar → ⚙ Schedule → Connect Google Calendar**

---

## Public Scheduling Page

Each user can enable a public booking page at `/book/:slug`.

1. Go to **Calendar → ⚙ Schedule**
2. Set your URL slug, slot duration, and availability
3. Share the link — clients pick a slot and it auto-creates a calendar event, activity, and reminder

---

## Project Structure

```
resiq-crm/
├── client/               # React frontend (Vite)
│   └── src/
│       ├── components/   # Shared UI components
│       ├── context/      # AuthContext
│       └── pages/        # One file per route
├── server/               # Express API
│   └── src/
│       ├── middleware/   # auth.js
│       ├── models/       # db.js (pg Pool)
│       ├── routes/       # One file per resource
│       ├── services/     # Gmail, Google Calendar, OAuth, audit logger
│       └── workers/      # Bull queue workers
├── database/
│   └── migrations/       # SQL migration files (run in order)
└── docker-compose.yml    # Postgres + Redis for local dev
```

---

## Roadmap

- **Phase 14** — Client Portal (client auth, proposal signing, invoice payment)
- **Phase 15** — SMS via Twilio (two-way messaging, opt-out, templates)
