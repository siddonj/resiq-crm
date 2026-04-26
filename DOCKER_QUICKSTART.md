# Docker Setup for Testing - Quick Start

## 🐳 Start Docker Containers

Run this command in your terminal:

```bash
docker-compose up -d
```

This will start:
- ✅ PostgreSQL on port 5434 (localhost:5434)
- ✅ Redis on port 6379
- Containers run in background (detached mode)

Expected output:
```
[+] Running 2/2
 ✔ Container resiq-postgres  Started
 ✔ Container resiq-redis     Started
```

---

## ⏳ Wait for Containers to Be Ready

Check if database is ready (should say "healthy"):

```bash
docker-compose ps
```

Expected output:
```
NAME               STATUS
resiq-postgres     Up 5 seconds (healthy)
resiq-redis        Up 5 seconds (healthy)
```

Wait until both show "(healthy)" before proceeding.

---

## 🗄️ Run Migrations

Once containers are healthy, run:

```bash
node run-all-migrations.js
```

The script will connect to: `postgresql://resiq:resiq@localhost:5434/resiq_crm`

Expected output:
```
🔌 Connecting to database...
   URL: postgresql://resiq:***@localhost:5434/resiq_crm

✓ Connected to database
✓ Loaded 14 migrations
✓ Running: 001-create-base-tables.sql
...
✓ Running: 014-add-reddit-leads.sql

✓ All migrations completed successfully
```

---

## 🚀 Start Dev Server

```bash
npm run install:all  # (if not already done)
npm run dev
```

This starts:
- Frontend: http://localhost:5173
- Backend: http://localhost:5000
- Backend connects to Docker database

---

## 🎯 Test Reddit Lead Finder

1. Get free API key: https://console.anthropic.com/
2. Add to .env: `ANTHROPIC_API_KEY=sk-ant-xxx`
3. Navigate to: http://localhost:5173/reddit-leads
4. Search: subreddits=`startups`, keywords=`need crm`
5. Click "🚀 Search Reddit"

---

## 🔍 Check Docker Logs

If something goes wrong, check:

```bash
# PostgreSQL logs
docker-compose logs postgres | tail -50

# Redis logs  
docker-compose logs redis | tail -50

# Container status
docker-compose ps
```

---

## 🛑 Stop Containers (When Done)

```bash
docker-compose down
```

This stops all containers but keeps data in volumes (can restart later).

To also delete data:
```bash
docker-compose down -v
```

---

## ✅ Quick Checklist

- [ ] `docker-compose up -d`
- [ ] `docker-compose ps` → both show "(healthy)"
- [ ] `node run-all-migrations.js` → success message
- [ ] Add ANTHROPIC_API_KEY to .env
- [ ] `npm run dev`
- [ ] Visit http://localhost:5173/reddit-leads
- [ ] Search and see leads!

---

Done! Start with: `docker-compose up -d`
