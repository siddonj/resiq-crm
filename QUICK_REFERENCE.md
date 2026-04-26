# ResiQ CRM - Quick Reference Guide

## 🚀 Getting Started (First Time)

```bash
# 1. Setup everything in one command
node setup.js

# 2. Edit your configuration
nano .env    # Set DATABASE_URL and SMTP settings

# 3. Start development
npm run dev

# Open browser: http://localhost:5173
```

---

## 📍 Key URLs

| Feature | URL | Notes |
|---------|-----|-------|
| **Dashboard** | http://localhost:5173 | Main CRM dashboard |
| **Contacts** | http://localhost:5173/contacts | Contact management |
| **Deals** | http://localhost:5173/deals | Pipeline view |
| **Help Desk** | http://localhost:5173/help-desk | 🆕 Support tickets (staff) |
| **Client Portal** | http://localhost:5173/client | Client-facing app |
| **Client Tickets** | http://localhost:5173/client/tickets | 🆕 Submit support request |
| **Proposals** | http://localhost:5173/proposals | Proposal management |
| **Invoices** | http://localhost:5173/invoices | Invoice management |

---

## 🛠️ Common Commands

```bash
# Install dependencies
npm install:all

# Run database migrations
npm run migrate

# Start development server (frontend + backend)
npm run dev

# Start only frontend (Vite)
cd client && npm run dev

# Start only backend
cd server && npm run dev

# Build for production
cd client && npm run build

# Run tests
npm run test

# Lint code
npm run lint
```

---

## 📦 API Endpoints

### Tickets (Phase 20)

```bash
# List all tickets
curl http://localhost:5000/api/tickets \
  -H "Authorization: Bearer TOKEN"

# Create ticket
curl -X POST http://localhost:5000/api/tickets \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Bug report","description":"...","priority":"high"}'

# Update ticket status
curl -X PATCH http://localhost:5000/api/tickets/1 \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress","assigned_to":2}'

# Add reply
curl -X POST http://localhost:5000/api/tickets/1/replies \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Working on it now"}'
```

### Engagement (Phase 19)

```bash
# Get engagement timeline for contact
curl http://localhost:5000/api/engagement/1 \
  -H "Authorization: Bearer TOKEN"

# Get dashboard metrics
curl http://localhost:5000/api/analytics/engagement/summary \
  -H "Authorization: Bearer TOKEN"
```

---

## 🔌 Environment Variables

### Essential
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/resiq_crm
JWT_SECRET=your_random_secret_min_64_chars
ENCRYPTION_KEY=exactly-32-chars-for-aes-encryption
PORT=5000
NODE_ENV=development
```

### Email (Optional - for ticket notifications)
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your_app_password     # Gmail: use App Password!
SMTP_FROM=noreply@example.com
```

### Optional Services
```env
REDIS_URL=redis://localhost:6379
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
STRIPE_SECRET_KEY=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
```

---

## 🗄️ Database

### Check PostgreSQL Status
```bash
# Windows/Docker
docker-compose ps

# Linux/Mac
brew services list
```

### Access Database
```bash
psql postgresql://resiq:password@localhost:5432/resiq_crm

# Or using .env
export DATABASE_URL=$(grep DATABASE_URL .env | cut -d= -f2)
psql $DATABASE_URL
```

### View Tables
```sql
\dt                           -- List all tables
SELECT * FROM tickets;        -- View tickets
SELECT * FROM engagement_tracking;  -- View engagement data
\q                            -- Exit
```

### Reset Database (Development Only)
```bash
# Drop and recreate
dropdb resiq_crm
createdb resiq_crm

# Re-run migrations
npm run migrate
```

---

## 🎯 Phase 19: Engagement Tracking

### Features
- Track when prospects open proposals and invoices
- View engagement timeline in contact detail
- Dashboard shows open rates by asset type

### How to Use
1. Create a proposal or invoice with a contact
2. System auto-injects tracking pixel
3. When prospect opens it → tracked automatically
4. View timeline in Contact → Engagement tab

### Debug Tracking
```bash
# Check if tracking pixels are injected
curl http://localhost:5000/api/track/[tracking-id].png -I

# Should return 200 OK with image headers
# Check database
psql $DATABASE_URL -c "SELECT * FROM engagement_tracking ORDER BY created_at DESC LIMIT 5;"
```

---

## 🎟️ Phase 20: Support Tickets

### Features (Staff)
- **Help Desk** → View all tickets in Kanban board
- **Kanban columns:** Open, In Progress, Waiting, Resolved, Closed
- **Assign tickets** → Email notification sent to assigned staff
- **Real-time updates** → See changes without refresh (green dot = live)
- **Reply to tickets** → Add notes and updates

### Features (Client)
- **Client Portal** → Submit new support requests
- **View tickets** → Track status of submitted requests
- **Reply to tickets** → Respond to staff replies
- **No login required** → Simple form to submit

### Common Workflows

**Assign a ticket to yourself:**
```
Help Desk → Click ticket → Click "Assign to Me" → Status updates live
```

**Reply as staff:**
```
Help Desk → Ticket detail → Bottom section "Add Reply" → Type message → Post
```

**Create ticket as client:**
```
Client Portal → Support → New Ticket → Fill form → Submit
```

---

## 🔴 Troubleshooting

### Server Won't Start
```bash
# Check if port 5000 is in use
lsof -i :5000          # Linux/Mac
netstat -ano | grep 5000  # Windows

# Kill process if needed
kill -9 <PID>          # Linux/Mac
taskkill /PID <PID>    # Windows
```

### Migrations Failed
```bash
# Reinstall dependencies
npm install

# Run migrations
npm run migrate

# Check logs for errors
psql $DATABASE_URL -c "SELECT * FROM information_schema.tables WHERE table_schema='public';"
```

### WebSocket Not Connecting
```
1. Check server is running: npm run dev
2. Check browser console (F12) for errors
3. Help Desk should show "Live Updates Enabled" (green)
4. Try refreshing page
```

### Email Not Sending
```
1. Check SMTP settings in .env
2. Gmail? Use App Password (not regular password)
3. Check server logs for [EMAIL] messages
4. Try sending test email manually
```

See **SETUP.md** for detailed troubleshooting.

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| **README.md** | Project overview and features |
| **SETUP.md** | Detailed setup and deployment guide |
| **QUICK_REFERENCE.md** | This file |
| **PHASE_19_20_IMPLEMENTATION.md** | Technical implementation details |
| **PHASE_EXPANSION_PLAN.md** | Full roadmap of all phases |
| **DEPLOYMENT.md** | Docker and production deployment |

---

## 🆘 Getting Help

### Check Logs
```bash
# Server logs (terminal where you ran npm run dev)
# Look for [ERROR], [WARN], [EMAIL], [WEBSOCKET]

# Browser console (F12)
# Check for JavaScript errors or network issues

# Database logs
docker-compose logs postgres  # If using Docker
```

### Common Error Messages

| Error | Solution |
|-------|----------|
| `Cannot find module 'pg'` | Run `npm install` |
| `DATABASE_URL not set` | Create .env with DATABASE_URL |
| `ECONNREFUSED localhost:5432` | PostgreSQL not running |
| `WebSocket connection failed` | Server not running or JWT invalid |
| `Email not sending` | Check SMTP config and credentials |

---

## 💡 Tips & Tricks

### Quick Database Check
```bash
# How many tickets exist?
psql $DATABASE_URL -c "SELECT COUNT(*) FROM tickets;"

# List open tickets
psql $DATABASE_URL -c "SELECT id, subject, assigned_to FROM tickets WHERE status='open';"

# View engagement data
psql $DATABASE_URL -c "SELECT COUNT(*) FROM engagement_tracking GROUP BY asset_type;"
```

### Monitor Real-time Activity
```bash
# Watch for new tickets (every 2 seconds)
watch -n 2 "psql $DATABASE_URL -c \"SELECT COUNT(*) FROM tickets WHERE status='open';\""
```

### Test Email Configuration
```bash
# Use curl to test SMTP (if you know the details)
# Or check server logs when you assign a ticket
```

### Clear Development Data
```bash
# Delete all tickets (dev only!)
psql $DATABASE_URL -c "DELETE FROM tickets CASCADE;"

# Delete all engagement records
psql $DATABASE_URL -c "DELETE FROM engagement_tracking;"
```

---

## 🔐 Security Notes

- **JWT Secret** — Change in production! Use strong random value (64+ chars)
- **Encryption Key** — Must be exactly 32 characters
- **Database Password** — Use strong password in production
- **SMTP Credentials** — Store in .env, never commit to git
- **Gmail App Password** — Use app-specific password, not your main password
- **WebSocket Token** — JWT automatically included, expires like normal tokens

---

## 📊 Monitoring (Production)

### Key Metrics to Watch
```bash
# Database connections
psql $DATABASE_URL -c "SELECT count(*) as connections FROM pg_stat_activity;"

# Table sizes
psql $DATABASE_URL -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;"

# Slow queries (enable log_min_duration_statement in PostgreSQL)
```

### Backup Database
```bash
# Full backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Restore from backup
psql $DATABASE_URL < backup-20260101.sql
```

---

**Last Updated:** 2026-04-26 | **Version:** 1.0.0
