# Database Setup - Windows Guide

## ⚠️ Issue: DATABASE_URL Not Being Read

The migration script couldn't connect to your database. This usually means:

1. **PostgreSQL isn't running** ← Most common
2. Wrong credentials in DATABASE_URL
3. PostgreSQL not installed

---

## ✅ Check If PostgreSQL is Running

### Option 1: Windows Services (Easiest)
1. Press `Win + R`
2. Type: `services.msc`
3. Look for **"postgresql"** service
4. Status should show **"Running"**
5. If it says "Stopped", right-click → **Start**

### Option 2: Command Line Check
```powershell
Get-Service postgresql* | Select-Object Name, Status
```

Expected output:
```
Name            Status
----            ------
postgresql-x64  Running
```

### Option 3: Try Connecting with psql
```bash
psql -U resiq -d resiq_crm
```

If it works, you'll see:
```
resiq_crm=>
```

If it fails, you'll see:
```
psql: error: could not connect to server: Connection refused
```

---

## 🔧 If PostgreSQL Isn't Running

### Windows - Start PostgreSQL Service
```powershell
# Run PowerShell as Administrator, then:
Start-Service postgresql-x64
```

Or use Services GUI:
1. Services → postgresql → Right-click → Start

### Windows - If PostgreSQL Isn't Installed

**Download & Install:**
1. Go to: https://www.postgresql.org/download/windows/
2. Download **PostgreSQL 14+**
3. Run installer
4. Set password: `resiq` (or remember what you set)
5. Port: `5432` (default)
6. After install, PostgreSQL should start automatically

---

## 🗄️ Create Database (If Missing)

Once PostgreSQL is running, create the database:

```bash
# Connect as postgres user (will prompt for password)
psql -U postgres

# Inside psql prompt, create database and user:
CREATE DATABASE resiq_crm;
CREATE USER resiq WITH PASSWORD 'resiq';
ALTER ROLE resiq WITH CREATEDB;
GRANT ALL PRIVILEGES ON DATABASE resiq_crm TO resiq;
\q
```

**Or use createdb command:**
```bash
createdb -U postgres resiq_crm
createuser -U postgres resiq
# Set password:
psql -U postgres -c "ALTER USER resiq WITH PASSWORD 'resiq';"
```

---

## ✅ Verify Your Setup

Run this command to verify everything works:

```bash
psql -U resiq -d resiq_crm -c "SELECT version();"
```

Expected output:
```
                        version
─────────────────────────────────────────────────────────────
 PostgreSQL 14.x on x86_64-pc-windows-mingw32...
(1 row)
```

---

## 🚀 Once PostgreSQL is Running

Try migrations again:

```bash
node run-all-migrations.js
```

Expected output:
```
🔌 Connecting to database...
   URL: postgresql://resiq:***@localhost:5432/resiq_crm

✓ Connected to database

✓ Loaded 14 migrations
✓ Running: 001-create-base-tables.sql
  ... (logs for each migration)
✓ Running: 014-add-reddit-leads.sql

✓ All migrations completed successfully
```

---

## 🐛 Troubleshooting

### "Connection refused" on port 5432
- PostgreSQL isn't running
- Solution: Start PostgreSQL service (see above)

### "FATAL: password authentication failed"
- Wrong password in DATABASE_URL
- Solution: Check .env file, update password to match PostgreSQL setup
- Or reset PostgreSQL password: `ALTER USER resiq WITH PASSWORD 'resiq';`

### "database resiq_crm does not exist"
- Database wasn't created
- Solution: Run createdb command above

### "role resiq does not exist"
- User wasn't created
- Solution: Run createuser command above

---

## 📋 Your Current Setup

**From .env file:**
```
DATABASE_URL=postgresql://resiq:resiq@localhost:5432/resiq_crm
POSTGRES_USER=resiq
POSTGRES_PASSWORD=resiq
POSTGRES_DB=resiq_crm
```

This means:
- **Host:** localhost
- **Port:** 5432
- **Database:** resiq_crm
- **User:** resiq
- **Password:** resiq

---

## 💡 Quick Fix Checklist

- [ ] PostgreSQL service is running (Check Services)
- [ ] psql command works: `psql -U resiq -d resiq_crm`
- [ ] .env file exists and has DATABASE_URL
- [ ] Run: `node run-all-migrations.js`
- [ ] See success message with all 14 migrations ✓

---

**Once database is set up, run:**
```bash
npm run install:all
node run-all-migrations.js
npm run dev
```

Then visit: http://localhost:5173/reddit-leads
