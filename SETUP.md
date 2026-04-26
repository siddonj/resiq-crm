# ResiQ CRM - Setup & Deployment Guide

Complete setup instructions for Phase 19 (Engagement Tracking) and Phase 20 (Support Ticketing) with optional enhancements.

## 📋 Prerequisites

- **Node.js** 16+ (check: `node --version`)
- **PostgreSQL** 12+ (check: `psql --version`)
- **Git** (for version control)

---

## 🚀 Quick Start (5 minutes)

### 1. Install Dependencies

```bash
cd C:\repo\prompts\resiq-crm
npm install:all
```

This installs:
- Root dependencies (dotenv, pg for migrations)
- Server dependencies (express, pg, ws, nodemailer, etc.)
- Client dependencies (react, axios, etc.)

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in required values:

```bash
cp .env.example .env
```

**Essential variables:**
```env
# Database (PostgreSQL)
DATABASE_URL=postgresql://resiq:password@localhost:5432/resiq_crm
POSTGRES_USER=resiq
POSTGRES_PASSWORD=your_strong_password
POSTGRES_DB=resiq_crm

# JWT & Security
JWT_SECRET=your_random_64_character_secret_here
ENCRYPTION_KEY=your_32_character_encryption_key

# Email (for ticket notifications)
SMTP_FROM=noreply@resiq.co
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your_gmail_app_password

# Optional: Twilio, Stripe, Google integrations
# (See .env.example for full list)
```

### 3. Create & Run Migrations

```bash
npm run migrate
```

Expected output:
```
🔌 Connecting to database...
✓ Connected to database

📋 Found 13 migration files

▶️  Running: 001-initial-schema.sql
✅ 001-initial-schema.sql completed

... (more migrations)

✅ All migrations completed successfully! (13/13)
```

### 4. Start Development Server

```bash
npm run dev
```

This starts both server (port 5000) and client (port 5173) with hot-reload.

---

## 📚 Key Features Setup

### Phase 19: Engagement Tracking ✨

**What it does:** Track when prospects open proposals, invoices, and emails.

**Automatic setup:**
- Migration `012-add-engagement-tracking.sql` creates tables
- Tracking pixel embedded in proposal PDFs
- Open rates calculated in analytics dashboard

**Access:**
- View engagement timeline: Contact detail → Engagement Timeline tab
- Analytics: `/api/analytics/engagement/summary`

---

### Phase 20: Support Ticketing 🎟️

**What it does:** Centralized support desk with ticket management.

**Automatic setup:**
- Migration `013-add-support-tickets.sql` creates tables
- Help Desk page at `/help-desk` (employees only)
- Client portal at `/client/tickets` (clients)

**Features:**
- ✅ Kanban board (5 status columns)
- ✅ Auto-assignment with email notifications
- ✅ Real-time updates via WebSocket
- ✅ Client ticket submission (no login required)
- ✅ Full activity audit trail

**Access:**
- Employees: Dashboard → Help Desk
- Clients: Client Portal → Support Tickets

---

### Optional: WebSocket Live Updates 🔴

**Real-time ticket updates** for Help Desk.

**Setup (automatic):**
- WebSocket server running at `ws://localhost:5000/ws/tickets`
- JWT token authentication via `Sec-WebSocket-Protocol` header
- Auto-reconnect on disconnect

**Status indicator:**
- Green dot = Connected and receiving live updates
- Gray dot = Connecting or offline

**What broadcasts:**
- New ticket created
- Ticket status/priority changed
- New replies added

---

### Optional: Email Notifications 📧

**Automatic emails** when tickets are assigned.

**Setup:**
1. Configure SMTP credentials in `.env`
2. Set `SMTP_FROM` to your reply-to email
3. Server auto-sends on ticket assignment

**Templates:**
- Ticket assigned to employee
- Client reply notification

**Testing:**
```bash
# Without real SMTP configured, emails log to console
curl -X POST http://localhost:5000/api/tickets \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Test","description":"Test ticket","priority":"high"}'
```

---

## 🔑 Environment Variables Reference

### Database
```env
DATABASE_URL=postgresql://user:pass@host:5432/db_name
# OR individual values:
POSTGRES_USER=resiq
POSTGRES_PASSWORD=change_me
POSTGRES_DB=resiq_crm
```

### Security
```env
JWT_SECRET=random_64_char_string_minimum
ENCRYPTION_KEY=32_char_string_for_encryption
NODE_ENV=production  # or development
```

### Email
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=app_password_not_regular_password
SMTP_FROM=noreply@resiq.co
```

### App URLs
```env
CLIENT_PORTAL_URL=https://youromain.com
API_URL=https://yourdomain.com
DOMAIN=yourdomain.com
```

---

## 📊 Database Schema

### Phase 19 Tables
- **engagement_tracking** - Tracks opens of proposals/invoices/emails
  - Fields: tracking_id (unique), asset_type, opened_at, ip_address, user_agent

### Phase 20 Tables
- **tickets** - Support tickets
  - Fields: subject, description, status (open/in_progress/waiting/resolved/closed), priority, assigned_to
- **ticket_replies** - Ticket conversations
  - Fields: ticket_id, user_id, message, created_at
- **ticket_activities** - Audit trail
  - Fields: ticket_id, user_id, action, details (JSON)

---

## 🧪 Testing

### Test Ticket Creation
```bash
curl -X POST http://localhost:5000/api/tickets \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Test ticket",
    "description": "This is a test",
    "priority": "medium"
  }'
```

### Test WebSocket Connection
```bash
wscat -c ws://localhost:5000/ws/tickets -H "Sec-WebSocket-Protocol: Bearer YOUR_JWT_TOKEN"
```

### Test Client Portal Ticket
```bash
curl -X POST http://localhost:5000/api/client-portal/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Client support request",
    "description": "Need help with proposal",
    "priority": "high"
  }'
```

---

## 🚨 Troubleshooting

### Migration fails: "Cannot find module 'dotenv'" or "Cannot find module 'pg'"

This error means dependencies haven't been installed. The migration script now handles this gracefully.

**Solution:**
```bash
npm install              # Install root dependencies
npm run migrate          # Retry migrations
```

Or use the quick setup script:
```bash
node setup.js            # Auto-installs dependencies and runs migrations
```

### Migration fails: "DATABASE_URL environment variable not set"

The migration script needs to know which database to connect to.

**Solution:**
1. Copy `.env.example` to `.env`
2. Edit `.env` and set `DATABASE_URL`:
   ```env
   DATABASE_URL=postgresql://resiq:password@localhost:5432/resiq_crm
   ```
3. Run migrations again:
   ```bash
   npm run migrate
   ```

### Migration fails: "Error: ECONNREFUSED" (PostgreSQL connection refused)

PostgreSQL server is not running or connection details are wrong.

**Check PostgreSQL is running:**
```bash
# On Windows (SQL Server running in Docker):
docker-compose ps

# Or check if service is running:
psql --version
psql -U postgres  # Test connection
```

**Create the database if needed:**
```bash
createdb resiq_crm
psql resiq_crm -f database/migrations/001-initial-schema.sql
```

**Verify DATABASE_URL format:**
- ✓ Correct: `postgresql://resiq:password@localhost:5432/resiq_crm`
- ✗ Wrong: `postgres://...` (old format, some versions don't support)
- ✗ Wrong: Missing password or port

### WebSocket connection refused

Real-time updates aren't connecting.

**Check:**
1. Server is running: `npm run dev` should show `✓ Server listening on port 5000`
2. JWT token is valid (check browser console for errors)
3. Server logs should show: `✓ WebSocket client connected: user [id]`
4. Open browser DevTools → Network → WS tab to inspect WebSocket connection

### Emails not sending (ticket notifications)

Assigned tickets aren't sending notification emails.

**Check:**
1. SMTP credentials in `.env`:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your@email.com
   SMTP_PASS=your_app_password    # NOT your regular password!
   SMTP_FROM=noreply@example.com
   ```
2. Gmail users: Use "App Password" not regular password
   - Enable 2-factor authentication
   - Generate app-specific password at https://myaccount.google.com/app-passwords
3. Check server logs for `[EMAIL]` debug messages
4. Test manually:
   ```bash
   curl -X PATCH http://localhost:5000/api/tickets/1 \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"assigned_to": 2}'  # Assign to different user
   ```

### Database connection refused

Cannot connect to PostgreSQL at startup.

**Solution:**
```bash
# Verify database exists
psql -U postgres -c "CREATE DATABASE resiq_crm;"

# Verify user has permissions
psql -U postgres -c "GRANT ALL ON DATABASE resiq_crm TO resiq;"

# Test connection
psql -U resiq -d resiq_crm -c "SELECT 1;"

# Run migrations
npm run migrate
```

---

## 📈 Production Deployment

### Using Docker (recommended)
```bash
docker-compose up -d
# Includes PostgreSQL, Redis, Nginx
```

### Manual Deployment
```bash
# 1. Build client
cd client && npm run build && cd ..

# 2. Set NODE_ENV
export NODE_ENV=production

# 3. Run migrations
npm run migrate

# 4. Start server
npm start
```

---

## 📚 API Documentation

### Tickets API

**List tickets:**
```
GET /api/tickets?status=open&priority=urgent
Authorization: Bearer JWT_TOKEN
```

**Create ticket:**
```
POST /api/tickets
Authorization: Bearer JWT_TOKEN
{
  "subject": "Issue title",
  "description": "Full details",
  "priority": "low|medium|high|urgent",
  "assigned_to": "user_id"
}
```

**Update ticket:**
```
PATCH /api/tickets/:ticketId
Authorization: Bearer JWT_TOKEN
{
  "status": "in_progress|waiting|resolved|closed",
  "priority": "medium",
  "assigned_to": "user_id"
}
```

**Add reply:**
```
POST /api/tickets/:ticketId/replies
Authorization: Bearer JWT_TOKEN
{
  "message": "Reply text here"
}
```

---

## 🔗 Quick Links

- **Help Desk:** http://localhost:5000/help-desk
- **Client Portal:** http://localhost:5000/client/tickets
- **API Health:** http://localhost:5000/api/health
- **Engagement Analytics:** http://localhost:5000/api/analytics/engagement/summary

---

## ❓ FAQ

**Q: Do I need Redis?**
A: No for Phase 19/20. Yes for SMS, workflows, email sync (optional features).

**Q: Can clients submit tickets without login?**
A: Yes! `/api/client-portal/tickets` requires `client_id` only, not authentication.

**Q: Are ticket notifications automatic?**
A: Yes, when `assigned_to` changes, email is sent to assigned employee.

**Q: How do I get real-time Help Desk updates?**
A: WebSocket connects automatically. Green status dot = live. No special config needed.

**Q: Can I run migrations manually?**
A: Yes: `node run-all-migrations.js` or `npm run migrate`

---

**Last Updated:** 2026-04-26
**Version:** 1.0.0
