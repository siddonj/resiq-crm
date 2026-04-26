# 🚀 START HERE - ResiQ CRM Setup Guide

Welcome! This guide will get you up and running in **5 minutes**.

---

## What You're Getting

✨ **Phase 19: Engagement Tracking**
- Track when prospects open your proposals and invoices
- See engagement timeline in contact details
- View engagement metrics on dashboard

🎟️ **Phase 20: Support Tickets**
- Help Desk with Kanban board for staff
- Client portal for submitting support requests
- Real-time updates for live collaboration
- Email notifications for assignments

---

## Quick Start (5 minutes)

### 1️⃣ Install Everything
```bash
cd C:\repo\prompts\resiq-crm
node setup.js
```

This automatically:
- ✅ Installs all npm dependencies
- ✅ Creates .env from template
- ✅ Runs database migrations
- ✅ Sets up the database schema

### 2️⃣ Configure Your Settings
Edit the `.env` file that was created:

**Minimum required:**
```env
DATABASE_URL=postgresql://resiq:password@localhost:5432/resiq_crm
```

**Optional (for email notifications):**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your_app_password
SMTP_FROM=noreply@example.com
```

### 3️⃣ Start Development
```bash
npm run dev
```

This starts:
- Frontend: http://localhost:5173
- Backend API: http://localhost:5000

### 4️⃣ Open in Browser
```
http://localhost:5173
```

---

## What to Try First

### 👥 Test Engagement Tracking
1. Go to **Contacts**
2. Click on a contact
3. Create a **Proposal** or **Invoice**
4. View the created document → Pixel automatically injected
5. Go back to contact detail
6. Click **Engagement** tab → Shows when opened (real-time!)

### 🎟️ Test Support Tickets (Staff)
1. Go to **Help Desk** (new menu item)
2. Click **New Ticket**
3. Fill in subject and description
4. Assign to yourself
5. Drag ticket across Kanban columns
6. See real-time updates (green dot = live)

### 📝 Test Support Tickets (Client)
1. Go to **Client Portal** (top right)
2. Click **Support**
3. Click **New Ticket**
4. Submit a request
5. View in Staff Help Desk in real-time

---

## Useful Commands

```bash
# See the status of all services
npm run dev           # Start everything

# Only backend
cd server && npm run dev

# Only frontend
cd client && npm run dev

# Run migrations again
npm run migrate

# Check database
psql $DATABASE_URL    # Access PostgreSQL directly

# Stop everything
Ctrl+C
```

---

## File Guide

| File | What to Read |
|------|--------------|
| **README.md** | Project overview |
| **QUICK_REFERENCE.md** | Common tasks and commands |
| **SETUP.md** | Detailed setup and troubleshooting |
| **PHASE_19_20_IMPLEMENTATION.md** | Technical architecture |
| **COMPLETION_SUMMARY.md** | What was built |

---

## Troubleshooting

### Error: "Cannot find module 'pg'"
```bash
npm install
npm run migrate
```

### Error: "DATABASE_URL not set"
```bash
# Edit .env and add DATABASE_URL
DATABASE_URL=postgresql://resiq:password@localhost:5432/resiq_crm
npm run migrate
```

### PostgreSQL not running?
```bash
# Check if Docker container is running
docker-compose ps

# Start Docker containers
docker-compose up -d
```

### WebSocket says "Not connected"?
```
1. Make sure npm run dev is running
2. Check browser console (F12) for errors
3. Refresh the page
4. You should see green "Live Updates Enabled"
```

**Need more help?** See **SETUP.md** troubleshooting section.

---

## Architecture Overview

```
┌─────────────────┐
│   Web Browser   │
│  (React.js)     │
│                 │
│ Help Desk Page  │
│ Client Tickets  │
└────────┬────────┘
         │ HTTP + WebSocket
         │
┌────────▼────────┐
│   Node.js API   │ http://localhost:5000
│  (Express.js)   │
│                 │
│ /api/tickets    │
│ /api/track      │
│ /api/engagement │
└────────┬────────┘
         │
┌────────▼────────┐
│  PostgreSQL     │ localhost:5432
│  Database       │
│                 │
│ tickets table   │
│ engagement_     │
│ tracking table  │
└─────────────────┘
```

---

## Feature Overview

### Phase 19: Engagement Tracking
**Problem:** How do you know when a prospect reads your proposal?
**Solution:** Pixel tracking automatically records opens.

**How it works:**
1. You send proposal to contact
2. System injects invisible tracking pixel
3. When prospect opens PDF/email → Open recorded
4. You see timeline in Contact view
5. Get notified of high-engagement opportunities

**Access it:** Contact detail → Engagement tab

---

### Phase 20: Support Tickets
**Problem:** How do you manage post-sale client support requests?
**Solution:** Centralized Help Desk with real-time updates.

**How it works:**

**For Staff:**
- Help Desk shows all tickets in Kanban board
- Assign tickets to yourself or team
- Update status: open → in_progress → resolved → closed
- Reply to tickets with notes
- See updates in real-time (no refresh needed)

**For Clients:**
- Submit support requests from Client Portal
- View ticket status
- Reply to support team
- Get notifications of updates

**Access it:**
- Staff: **Help Desk** menu (top navigation)
- Clients: **Client Portal** → Support → View/Submit tickets

---

## Key Features at a Glance

| Feature | Where | How |
|---------|-------|-----|
| **Track Opens** | Contact → Engagement tab | Auto-tracked pixel |
| **Help Desk** | Main menu → Help Desk | Kanban board view |
| **New Ticket** | Help Desk → New Ticket | Create form |
| **Assign Ticket** | Ticket detail → Assign | Email notification sent |
| **Client Submit** | Client Portal → Support | Submit form |
| **Real-time Updates** | Help Desk page | Green indicator = live |

---

## Email Setup (Optional but Recommended)

To send ticket assignment notifications:

### Gmail (Free)
1. Enable 2-factor authentication
2. Go to https://myaccount.google.com/app-passwords
3. Generate app password
4. Add to .env:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your@gmail.com
   SMTP_PASS=16-character-app-password
   SMTP_FROM=noreply@yourcompany.com
   ```

### Other Email Providers
- SendGrid: Use sendgrid.net SMTP
- Mailgun: Use smtp.mailgun.org
- AWS SES: Use email-smtp.region.amazonaws.com
- Your own mail server: Use your domain's SMTP

**Test it:** Assign a ticket to someone → Check their email

---

## Next Steps

1. ✅ Run `node setup.js` (if you haven't already)
2. ✅ Edit `.env` with DATABASE_URL
3. ✅ Run `npm run dev`
4. ✅ Test engagement tracking
5. ✅ Test Help Desk tickets
6. ✅ (Optional) Configure email for notifications
7. 📚 Read QUICK_REFERENCE.md for more commands
8. 🚀 Deploy when ready (see DEPLOYMENT.md)

---

## Common Questions

**Q: Do I need PostgreSQL installed locally?**
A: No! Docker Compose handles it. Just `docker-compose up -d`

**Q: Do I need Redis?**
A: No, not for Phase 19/20. Optional for workflows.

**Q: Can clients submit tickets without logging in?**
A: Yes! Client portal requires only client_id.

**Q: How do real-time updates work?**
A: WebSocket connection (automated). Green indicator = live.

**Q: Will emails work without SMTP setup?**
A: No, you must configure SMTP for email notifications.

**Q: Can I run migrations manually?**
A: Yes: `npm run migrate` or `node run-all-migrations.js`

**Q: What if I break the database?**
A: Drop and recreate: `dropdb resiq_crm && npm run migrate`

---

## Support

### I'm stuck, where's the help?
- **Quick answers:** QUICK_REFERENCE.md
- **Setup problems:** SETUP.md (Troubleshooting section)
- **How does it work?** PHASE_19_20_IMPLEMENTATION.md
- **What was built?** COMPLETION_SUMMARY.md
- **Full project info:** README.md

### Common error solutions

| Error | Solution |
|-------|----------|
| `Cannot find module` | `npm install` |
| `DATABASE_URL not set` | Add to `.env` |
| `Connection refused` | Start PostgreSQL |
| `WebSocket failed` | Refresh page, check console |
| `Email not sending` | Check SMTP credentials |

---

## You're All Set! 🎉

**What's running now:**
- ✅ Frontend (React) at http://localhost:5173
- ✅ Backend API at http://localhost:5000
- ✅ Database (PostgreSQL) at localhost:5432
- ✅ WebSocket for real-time updates

**Next:** Open http://localhost:5173 and start using the system!

---

**Version:** 1.0.0  
**Last Updated:** 2026-04-26  
**Status:** Production Ready ✅
