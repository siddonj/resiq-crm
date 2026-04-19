# ResiQ CRM — Deployment Guide

## Architecture

```
Internet → Nginx (80/443) → Node App (5000) → PostgreSQL + Redis
```

All four services run as Docker containers on a single VPS via Docker Compose.

---

## VPS Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 22.04 | Ubuntu 22.04 |

**Recommended VPS providers:** DigitalOcean, Hetzner, Linode, Vultr
**Estimated cost:** $12–24/month

---

## First-Time Server Setup

```bash
# 1. Update the server
sudo apt update && sudo apt upgrade -y

# 2. Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 3. Install Docker Compose plugin
sudo apt install -y docker-compose-plugin

# 4. Log out and back in (for docker group to take effect)
exit
```

---

## Deploy ResiQ CRM

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_ORG/resiq-crm.git
cd resiq-crm

# 2. Copy and fill in environment variables
cp .env.example .env
nano .env   # Fill in all values

# 3. Replace YOUR_DOMAIN.com with your actual domain
export DOMAIN=yourdomain.com
export EMAIL=admin@yourdomain.com

# 4. Run the deploy script
chmod +x deploy.sh
./deploy.sh
```

---

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Random 64-char string for auth tokens |
| `POSTGRES_PASSWORD` | Strong database password |
| `REDIS_PASSWORD` | Redis password |
| `TWILIO_*` | Twilio SMS credentials |
| `STRIPE_*` | Stripe payment credentials |
| `GOOGLE_*` | Google OAuth for calendar sync |

Generate a secure JWT secret:
```bash
openssl rand -hex 32
```

---

## SSL Certificate (Let's Encrypt)

The deploy script handles this automatically. To renew manually:
```bash
docker compose run --rm certbot renew
docker compose restart nginx
```

Certificates auto-renew every 12 hours via the certbot container.

---

## Database Migrations

Migrations run automatically on first start (`/docker-entrypoint-initdb.d`).

To run manually:
```bash
docker compose exec postgres psql -U resiq -d resiq_crm \
  -f /docker-entrypoint-initdb.d/001-initial.sql
```

---

## Daily Operations

```bash
# Check status
docker compose ps

# View logs
docker compose logs -f app
docker compose logs -f nginx

# Restart app only
docker compose restart app

# Full restart
docker compose down && docker compose up -d

# Update to latest code
git pull
docker compose build app --no-cache
docker compose up -d app
```

---

## Database Backup

```bash
# Backup
docker compose exec postgres pg_dump -U resiq resiq_crm > backup_$(date +%Y%m%d).sql

# Restore
docker compose exec -T postgres psql -U resiq resiq_crm < backup_20260419.sql
```

Set up automated daily backups with cron:
```bash
crontab -e
# Add:
0 2 * * * cd /path/to/resiq-crm && docker compose exec postgres pg_dump -U resiq resiq_crm > /backups/backup_$(date +\%Y\%m\%d).sql
```

---

## Monitoring

```bash
# Container resource usage
docker stats

# App health
curl https://yourdomain.com/api/webhooks/health

# Disk usage
df -h
docker system df
```

---

## Local Development

```bash
# Start infrastructure only
docker compose up -d postgres redis

# Install dependencies
npm run install:all

# Start dev server (hot reload)
npm run dev
```

---

## Updating the App

```bash
git pull origin main
docker compose build app --no-cache
docker compose up -d app
# Zero-downtime: Docker Compose restarts only the app container
```


# 3. Copy and configure environment
cp server/.env.example server/.env
# Edit server/.env and update:
# - GMAIL_CLIENT_ID
# - GMAIL_CLIENT_SECRET  
# - JWT_SECRET (generate new value)
# - ENCRYPTION_KEY (generate new value)

# 4. Run migrations (first time only)
psql "$DATABASE_URL" -f database/migrations/001-add-oauth.sql
psql "$DATABASE_URL" -f database/migrations/002-add-workflows.sql

# 5. Start the dev server
npm run dev

# App will run on:
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:5000
# - Redis: localhost:6379
# - PostgreSQL: localhost:5433
```

### Verify Services Are Running

```bash
# Check Docker containers
docker-compose ps

# Test PostgreSQL connection
psql "postgresql://resiq:resiq_dev@localhost:5433/resiq_crm" -c "SELECT version();"

# Test Redis connection
redis-cli -p 6379 ping
# Should return: PONG
```

### Stop Services

```bash
# Stop and remove containers
docker-compose down

# Keep data volumes (database persists)
docker-compose down --volumes  # This removes volumes too
```

---

## Email Sync Testing (Gmail Integration)

### Step 1: Set Up Gmail OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project:
   - Click "Select a Project" → "New Project"
   - Name: "ResiQ CRM Testing"
   - Click "Create"

3. Enable Gmail API:
   - Click "Library"
   - Search for "Gmail API"
   - Click "Gmail API"
   - Click "Enable"

4. Create OAuth 2.0 Credentials:
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: "Web application"
   - Name: "ResiQ CRM Dev"
   - Authorized JavaScript origins: `http://localhost:5173`
   - Authorized redirect URIs: `http://localhost:5000/api/integrations/gmail/callback`
   - Click "Create"
   - Copy Client ID and Client Secret

5. Update `.env`:
   ```bash
   GMAIL_CLIENT_ID=your_client_id.apps.googleusercontent.com
   GMAIL_CLIENT_SECRET=your_client_secret
   ```

6. Restart the dev server:
   ```bash
   # Stop current: Ctrl+C
   npm run dev
   ```

### Step 2: Test Gmail Connection

1. Open app: `http://localhost:5173`
2. Log in with your test account
3. Go to **Settings** page
4. Click **"Connect Gmail"**
5. You'll be redirected to Google
6. Click "Allow" to authorize ResiQ
7. You should be redirected back to Settings with "Gmail connected" status ✅

**Verify in Database:**
```bash
psql "postgresql://resiq:resiq_dev@localhost:5433/resiq_crm"

# Check if OAuth tokens are stored (encrypted)
SELECT id, oauth_provider, oauth_access_token IS NOT NULL as has_token 
FROM users WHERE id = 'your-user-id';

# Should show:
# oauth_provider: gmail
# has_token: true
```

### Step 3: Test Email Sync

1. **Send a test email:**
   - From your authorized Gmail account, send an email to yourself
   - Subject: "Test email from ResiQ"

2. **Create a matching contact:**
   - In ResiQ, go to **Contacts**
   - Click "+ Add Contact"
   - Use the same email address as your Gmail account
   - Save

3. **Trigger email sync manually:**
   ```bash
   # Open Node REPL in server directory
   cd server
   node
   
   # Load and trigger the sync job
   const { emailSyncQueue } = require('./src/workers/emailSyncWorker');
   emailSyncQueue.add({ userId: 'your-user-id' });
   
   # Wait a few seconds, then exit
   .exit
   ```

4. **Verify emails appear:**
   - Go back to **Contacts** in ResiQ
   - Click "View" on the contact you created
   - Scroll down to "Email Communication" section
   - You should see the email ✅

5. **Check database:**
   ```bash
   psql "postgresql://resiq:resiq_dev@localhost:5433/resiq_crm"
   
   SELECT id, sender_email, subject FROM emails LIMIT 5;
   ```

### Step 4: Test 5-Minute Recurring Sync

1. Keep the dev server running (`npm run dev`)
2. Receive 2-3 new emails to your Gmail account in real time
3. Wait 5 minutes (the recurring job runs every 5 minutes)
4. Check the contact timeline
5. New emails should appear automatically ✅

---

## Workflow Testing

### Step 1: Create a Test Workflow

1. Go to **Workflows** page
2. Click "+ New Workflow"
3. **Step 1 - Details:**
   - Name: "Auto-task on deal won"
   - Description: "Create a task when deal stage changes to won"
   - Click "Next"

4. **Step 2 - Trigger:**
   - Select: "Deal Stage Changed"
   - Stage: "won"
   - Click "Next"

5. **Step 3 - Actions:**
   - Click "+ Add Action"
   - Action type: "Create Task"
   - Task Title: "Send contract for review"
   - Due in (days): 3
   - Click "Next"

6. **Step 4 - Review:**
   - Review the summary
   - Click "Create Workflow"

**Verify in Database:**
```bash
psql "postgresql://resiq:resiq_dev@localhost:5433/resiq_crm"

SELECT id, name, trigger_type FROM workflows WHERE name = 'Auto-task on deal won';
```

### Step 2: Test Workflow Execution

1. Go to **Pipeline** page
2. Find or create a deal (if none exist, create one)
3. Change the deal stage to **"won"**
4. Wait 2-3 seconds for the job to process
5. Go to the **Contacts** page and find the associated contact
6. Click "View" to open the contact detail
7. Scroll to "Email Communication" → you should see a new task created ✅

**Verify in Database:**
```bash
psql "postgresql://resiq:resiq_dev@localhost:5433/resiq_crm"

-- Check if task was created
SELECT id, title, due_date FROM tasks WHERE title = 'Send contract for review' ORDER BY created_at DESC LIMIT 1;

-- Check workflow execution history
SELECT workflow_id, status, executed_at FROM workflow_executions ORDER BY created_at DESC LIMIT 5;
```

### Step 3: Test Multiple Actions

1. Edit the workflow: **Workflows** → Click "Edit" on the workflow
2. Go to **Step 3 - Actions**
3. Click "+ Add Action" again
4. Action type: "Create Activity"
5. Description: "Workflow auto-logged deal won"
6. Click "Next" → "Save Changes"

7. Trigger the workflow again by moving a deal to "won" stage
8. Wait 3 seconds
9. Check the contact timeline → should now show:
   - ✅ Task created (same as before)
   - ✅ Activity logged (new) ✅

---

## Database Verification

### Verify Schema

```bash
psql "postgresql://resiq:resiq_dev@localhost:5433/resiq_crm"

-- List all tables
\dt

-- Should include:
-- - users (authentication)
-- - contacts (CRM contacts)
-- - deals (pipeline deals)
-- - tasks (reminders/tasks)
-- - activities (activity log)
-- - emails (synced emails)
-- - workflows (automation rules)
-- - workflow_executions (execution history)
```

### Verify Constraints

```bash
-- Check foreign key constraints
SELECT table_name, constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE constraint_type = 'FOREIGN KEY';

-- Check unique constraints
SELECT table_name, constraint_name 
FROM information_schema.table_constraints 
WHERE constraint_type = 'UNIQUE';
```

### Verify Indexes

```bash
-- Check indexes on critical tables
SELECT * FROM pg_indexes WHERE tablename IN ('emails', 'workflows', 'workflow_executions');

-- Should show indexes on:
-- - idx_emails_user_id
-- - idx_emails_contact_id
-- - idx_emails_gmail_id
-- - idx_workflows_user_id
-- - idx_workflows_trigger_type
-- - idx_workflow_executions_workflow_id
-- - idx_workflow_executions_created_at
-- - idx_workflow_executions_status
```

---

## Production Deployment

### Choose Your Platform

**Option A: Self-Hosted (VPS)**
- DigitalOcean, AWS EC2, Linode, Vultr, etc.
- Full control, can be cheaper long-term
- Requires server management & security setup

**Option B: Platform-as-a-Service (PaaS)**
- Heroku, Render, Railway, Fly.io
- Easy deployment, automatic scaling
- May be more expensive for high traffic

**Option C: Containerized (Kubernetes)**
- Google Cloud Run, AWS ECS, Kubernetes clusters
- Best for scaling, complex deployments

### General Deployment Steps

1. **Set up managed database:**
   - Create a PostgreSQL instance on your platform
   - Update `DATABASE_URL` in production `.env`

2. **Set up Redis:**
   - Create a Redis instance (via platform's managed service)
   - Update `REDIS_URL` in production `.env`

3. **Generate secrets:**
   ```bash
   # Custom JWT secret
   openssl rand -base64 32
   
   # Custom encryption key
   openssl rand -base64 32
   ```

4. **Deploy application:**
   - Push code to platform
   - Set environment variables
   - Run migrations: `psql $DATABASE_URL -f database/migrations/*.sql`
   - Start server

5. **SSL/TLS:**
   - Most PaaS platforms include automatic HTTPS
   - For self-hosted, use Let's Encrypt (Certbot)

6. **Monitoring:**
   - Set up error tracking (Sentry)
   - Add uptime monitoring
   - Track logs and performance

---

## Troubleshooting

### "Redis connection refused"
- Check Redis is running: `docker-compose ps`
- Verify Redis port forwarding in docker-compose.yml (default 6379)
- Restart Redis: `docker-compose restart redis`

### "Database connection refused"
- Check PostgreSQL is running: `docker-compose ps`
- Verify DATABASE_URL in `.env` matches docker-compose (port 5433)
- Check credentials: `psql -U resiq -h localhost -p 5433 -d resiq_crm`

### "Gmail OAuth shows invalid_client error"
- Double-check GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in `.env`
- Verify redirect URI in Google Cloud Console matches `localhost:5000/api/integrations/gmail/callback`
- Ensure Gmail API is enabled in Google Cloud Console

### "Emails not syncing"
- Verify Gmail is connected: Check database `oauth_provider` field
- Check Bull queue: `redis-cli -p 6379 keys "bull*"` should show queue keys
- Check server logs for errors
- Try manual sync with Node REPL (see Email Sync Testing)

### "Workflows not executing"
- Verify Redis is running
- Check database: `SELECT * FROM workflows WHERE enabled = true;`
- Verify workflow trigger type matches the event (e.g., "deal.stage_changed")
- Check execution history: `SELECT * FROM workflow_executions ORDER BY created_at DESC LIMIT 10;`

### "Database port conflicts"
- Default PostgreSQL port (5433) may be in use
- Change port in `docker-compose.yml` and `DATABASE_URL`
- Find what's using the port: `lsof -i :5433`

---

## Performance Tips

- Use database indexes for common queries (already set up)
- Set up Redis for caching (configured in docker-compose)
- Limit email sync to last 24 hours (not 30 days) after initial sync
- Archive old workflow execution records to a separate table
- Use connection pooling for PostgreSQL (handled by pg library)

---

## Security Checklist

- [ ] Change all example values (.env files)
- [ ] Use strong JWT_SECRET (minimum 32 characters)
- [ ] Use strong ENCRYPTION_KEY
- [ ] Enable HTTPS in production
- [ ] Add CORS restrictions (don't use `*`)
- [ ] Validate all user input on backend
- [ ] Use parameterized queries (already done with pg library)
- [ ] Add rate limiting to API endpoints
- [ ] Log and monitor for suspicious activity
- [ ] Regular security updates to dependencies (`npm audit`)

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs: `npm run dev` shows realtime logs
3. Check database with PostgreSQL CLI
4. Review workflow execution history for errors
5. Contact ResiQ support with:
   - Error message
   - Steps to reproduce
   - Server logs
   - Database state (exports, not passwords)

---

**Last Updated:** 2026-04-18  
**Version:** 1.0.0
