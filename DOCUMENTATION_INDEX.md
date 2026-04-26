# ResiQ CRM Documentation Index

## 🚀 Getting Started

**New to ResiQ CRM?** Start here:

1. **[START_HERE.md](START_HERE.md)** — 5-minute quick start guide
   - Setup in one command
   - First things to try
   - Common questions answered

2. **[README.md](README.md)** — Project overview
   - Feature list
   - Tech stack
   - Getting started (detailed)

3. **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** — Developer cheat sheet
   - Key URLs and commands
   - API endpoints
   - Common workflows
   - Troubleshooting quick answers

---

## 📚 Detailed Guides

### Setup & Deployment

- **[SETUP.md](SETUP.md)** — Complete setup guide (15 min)
  - Prerequisites and installation
  - Environment configuration
  - Database setup
  - Email configuration
  - Detailed troubleshooting
  - Production deployment

- **[DEPLOYMENT.md](DEPLOYMENT.md)** — Production deployment
  - Docker setup
  - Cloud deployment
  - SSL/TLS configuration
  - Monitoring

- **[setup.js](setup.js)** — One-command setup script
  - Auto-installs dependencies
  - Runs migrations
  - Configures .env

### Feature Documentation

- **[PHASE_19_20_IMPLEMENTATION.md](PHASE_19_20_IMPLEMENTATION.md)** — Technical deep dive
  - Phase 19: Engagement Tracking
  - Phase 20: Support Tickets
  - Optional enhancements
  - Architecture details
  - API endpoint reference
  - Database schema
  - Troubleshooting

- **[COMPLETION_SUMMARY.md](COMPLETION_SUMMARY.md)** — What was built
  - Implementation checklist
  - Files created/modified
  - Code statistics
  - Verification checklist
  - Deployment files

### Planning & Expansion

- **[PHASES.md](PHASES.md)** — All 20 phases overview
  - Phase descriptions
  - Completion status
  - Feature matrix

- **[PHASE_EXPANSION_PLAN.md](PHASE_EXPANSION_PLAN.md)** — Roadmap and expansion
  - Planned features
  - Future enhancements
  - Phase dependencies

---

## 🔍 Quick Navigation

### By Use Case

**I want to...**

| Goal | Document | Time |
|------|----------|------|
| Get started | [START_HERE.md](START_HERE.md) | 5 min |
| Install & configure | [SETUP.md](SETUP.md) | 15 min |
| Deploy to production | [DEPLOYMENT.md](DEPLOYMENT.md) | 30 min |
| Understand the architecture | [PHASE_19_20_IMPLEMENTATION.md](PHASE_19_20_IMPLEMENTATION.md) | 20 min |
| Find an API endpoint | [QUICK_REFERENCE.md](QUICK_REFERENCE.md) | 2 min |
| Troubleshoot a problem | [SETUP.md](SETUP.md) troubleshooting | 5 min |
| Run a database command | [QUICK_REFERENCE.md](QUICK_REFERENCE.md) database section | 2 min |
| See what was implemented | [COMPLETION_SUMMARY.md](COMPLETION_SUMMARY.md) | 10 min |

### By Role

**I am a...**

| Role | Start With | Then Read |
|------|-----------|-----------|
| **New Developer** | [START_HERE.md](START_HERE.md) | [QUICK_REFERENCE.md](QUICK_REFERENCE.md) |
| **DevOps Engineer** | [DEPLOYMENT.md](DEPLOYMENT.md) | [SETUP.md](SETUP.md) |
| **Frontend Dev** | [PHASE_19_20_IMPLEMENTATION.md](PHASE_19_20_IMPLEMENTATION.md) | [QUICK_REFERENCE.md](QUICK_REFERENCE.md) |
| **Backend Dev** | [PHASE_19_20_IMPLEMENTATION.md](PHASE_19_20_IMPLEMENTATION.md) | API endpoints section |
| **QA Tester** | [START_HERE.md](START_HERE.md) | Testing section in [SETUP.md](SETUP.md) |
| **Project Manager** | [COMPLETION_SUMMARY.md](COMPLETION_SUMMARY.md) | [PHASES.md](PHASES.md) |

---

## 📖 Feature Documentation

### Phase 19: Engagement Tracking

**Overview:** Track when prospects open proposals and invoices using pixel tracking.

**Documentation:**
- [START_HERE.md#Phase-19](START_HERE.md) — Feature overview
- [PHASE_19_20_IMPLEMENTATION.md#Phase-19](PHASE_19_20_IMPLEMENTATION.md) — Technical details
- [COMPLETION_SUMMARY.md#Phase-19](COMPLETION_SUMMARY.md) — What was built

**Quick Facts:**
- Database: `engagement_tracking` table
- API: `GET /api/track/:trackingId.png`
- Frontend: Contact → Engagement tab
- Dashboard: New engagement metrics card

---

### Phase 20: Support Tickets

**Overview:** Help Desk with Kanban board, real-time updates, and client portal integration.

**Documentation:**
- [START_HERE.md#Phase-20](START_HERE.md) — Feature overview
- [PHASE_19_20_IMPLEMENTATION.md#Phase-20](PHASE_19_20_IMPLEMENTATION.md) — Technical details
- [COMPLETION_SUMMARY.md#Phase-20](COMPLETION_SUMMARY.md) — What was built

**Quick Facts:**
- Database: `tickets`, `ticket_replies`, `ticket_activities` tables
- API: `/api/tickets` endpoints (CRUD + replies)
- Frontend: Help Desk page + Client Portal
- Real-time: WebSocket for live updates
- Email: Notifications on assignment

---

## 🛠️ Command Reference

### Setup Commands
```bash
node setup.js              # One-command setup
npm install:all           # Install all dependencies
npm run migrate            # Run database migrations
npm run dev               # Start development
```

### Development Commands
```bash
cd client && npm run dev  # Frontend only
cd server && npm run dev  # Backend only
npm run lint              # Run linter
npm run test              # Run tests
```

### Database Commands
```bash
npm run migrate                    # Run migrations
psql $DATABASE_URL                 # Access database
dropdb resiq_crm                   # Reset database
createdb resiq_crm                 # Create database
```

See [QUICK_REFERENCE.md](QUICK_REFERENCE.md) for more commands.

---

## 🔗 Key Files

### Setup & Configuration
- `setup.js` — One-command setup script
- `.env.example` — Environment template
- `.env` — Your local configuration (git-ignored)
- `package.json` — Root dependencies
- `server/package.json` — Server dependencies
- `client/package.json` — Client dependencies

### Database Migrations
- `database/migrations/012-add-engagement-tracking.sql` — Phase 19 schema
- `database/migrations/013-add-support-tickets.sql` — Phase 20 schema

### Server Code
- `server/src/routes/tickets.js` — Ticket CRUD API
- `server/src/routes/engagement.js` — Engagement API
- `server/src/services/ticketWebSocket.js` — Real-time updates
- `server/src/index.js` — WebSocket server setup

### Client Code
- `client/src/pages/HelpDesk.jsx` — Help Desk page
- `client/src/pages/client/Tickets.jsx` — Client portal
- `client/src/context/ticketWebSocket.js` — WebSocket client

---

## 📊 Status

| Phase | Feature | Status |
|-------|---------|--------|
| 19 | Engagement Tracking | ✅ Complete |
| 20 | Support Tickets | ✅ Complete |
| - | Optional Enhancements | ✅ Complete |
| - | Documentation | ✅ Complete |

**Overall Status:** 🎉 **Production Ready**

---

## 💬 FAQ

**Q: Where do I start?**
A: Read [START_HERE.md](START_HERE.md) — it's a 5-minute guide.

**Q: How do I set up the project?**
A: Run `node setup.js` — it does everything automatically.

**Q: Where's the API documentation?**
A: [QUICK_REFERENCE.md](QUICK_REFERENCE.md) has endpoints, [PHASE_19_20_IMPLEMENTATION.md](PHASE_19_20_IMPLEMENTATION.md) has details.

**Q: How do I troubleshoot problems?**
A: See [SETUP.md](SETUP.md) troubleshooting section.

**Q: What's the database schema?**
A: [PHASE_19_20_IMPLEMENTATION.md](PHASE_19_20_IMPLEMENTATION.md) has full schema.

**Q: How do I deploy to production?**
A: See [DEPLOYMENT.md](DEPLOYMENT.md).

**Q: What was built?**
A: See [COMPLETION_SUMMARY.md](COMPLETION_SUMMARY.md).

---

## 📞 Getting Help

| Issue Type | Solution | Document |
|------------|----------|----------|
| **Setup problems** | Follow SETUP.md | [SETUP.md](SETUP.md) |
| **Can't find a command** | See QUICK_REFERENCE.md | [QUICK_REFERENCE.md](QUICK_REFERENCE.md) |
| **WebSocket not working** | Check troubleshooting | [SETUP.md](SETUP.md) |
| **Email not sending** | See email setup guide | [START_HERE.md](START_HERE.md) |
| **Understand the code** | Read implementation details | [PHASE_19_20_IMPLEMENTATION.md](PHASE_19_20_IMPLEMENTATION.md) |
| **Database issues** | Database troubleshooting | [SETUP.md](SETUP.md) |

---

## 📝 Documentation Overview

This documentation includes:

✅ **Quick Start Guides**
- [START_HERE.md](START_HERE.md) — 5-minute setup
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) — Cheat sheet

✅ **Detailed Setup**
- [SETUP.md](SETUP.md) — Complete installation guide
- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment

✅ **Technical Documentation**
- [PHASE_19_20_IMPLEMENTATION.md](PHASE_19_20_IMPLEMENTATION.md) — Architecture & API
- [COMPLETION_SUMMARY.md](COMPLETION_SUMMARY.md) — What was built

✅ **Project Planning**
- [PHASES.md](PHASES.md) — Phase overview
- [PHASE_EXPANSION_PLAN.md](PHASE_EXPANSION_PLAN.md) — Roadmap

✅ **Configuration Files**
- [.env.example](.env.example) — Environment template
- [README.md](README.md) — Project readme

---

## 🎯 Recommended Reading Order

1. **First time setup:** [START_HERE.md](START_HERE.md) → [SETUP.md](SETUP.md)
2. **Quick reference:** [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
3. **Understanding features:** [PHASE_19_20_IMPLEMENTATION.md](PHASE_19_20_IMPLEMENTATION.md)
4. **Deployment:** [DEPLOYMENT.md](DEPLOYMENT.md)
5. **Troubleshooting:** [SETUP.md](SETUP.md) → Troubleshooting section

---

**Version:** 1.0.0  
**Last Updated:** 2026-04-26  
**Status:** Complete ✅
