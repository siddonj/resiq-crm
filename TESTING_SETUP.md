# Reddit Lead Finder - Testing Setup Guide

## ✅ What's Ready

Your environment is now configured for testing! Here's what I've set up:

1. **✅ .env file created** with all dev defaults
2. **✅ Reddit routes installed** in the API
3. **✅ React component created** and routed to /reddit-leads
4. **✅ Database migration ready** (014-add-reddit-leads.sql)
5. **✅ Documentation complete** (3 guides included)

---

## 🚀 Start Testing in 3 Steps

### Step 1: Install Dependencies
```bash
npm run install:all
```
This installs @anthropic-ai/sdk in server and all client dependencies.

### Step 2: Run Migrations
```bash
node run-all-migrations.js
```
Creates the reddit_leads, reddit_search_configs, and reddit_search_results tables.

**Expected output:**
```
✓ Loaded 13 migrations
✓ Running: 014-add-reddit-leads.sql
✓ Created reddit_leads table
✓ Created reddit_search_configs table
✓ Created reddit_search_results table
✓ All migrations completed successfully
```

### Step 3: Get API Key (Free!)
1. Visit: https://console.anthropic.com/
2. Sign up (takes 2 minutes)
3. Create API key
4. Copy to clipboard: `sk-ant-xxxxxxxxxxxxx`
5. Add to `.env`:
```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
```

### Step 4: Start Dev Server
```bash
npm run dev
```

**Expected output:**
```
[server] Listening on http://localhost:5000
[client] ✓ Vite dev server running at http://localhost:5173
```

---

## 🎯 Test the Feature

### Open the App
Navigate to: **http://localhost:5173/reddit-leads**

You should see:
- 📊 Stats dashboard (all zeros initially)
- 🔎 Search panel with subreddit/keyword inputs
- 📋 Lead cards grid (empty initially)

### Run Your First Search

**Search Config:**
- Subreddits: `startups`
- Keywords: `need crm`
- Min Relevance: `70%`

**Click "🚀 Search Reddit"**

**What happens:**
```
[1-2 sec]  → Searching r/startups...
[5-15 sec] → Claude analyzing posts...
[15-20 sec]→ Results: Found 45 discussions, Stored 38 as leads
```

### Review Results

You'll see lead cards like:

```
┌─────────────────────────────────────────┐
│ Growing from 5→15 people, need CRM      │ ← Post title
│ r/startups • jane_doe                   │ ← Source & author
│                                         │
│ "We're scaling our sales process..."    │ ← Content preview
│                                         │
│ [crm] [scaling] [sales] [growth]       │ ← Keywords matched
│                                         │
│ [New ▼] [×]                             │ ← Status & delete
│ 📧 jane.doe@example.com                 │ ← Contact (if extracted)
│ 📍 90%                                   │ ← Relevance score
└─────────────────────────────────────────┘
```

---

## 🧪 Test Scenarios

### Scenario 1: Quality Filtering
**Test if relevance scoring works:**
```
Search: r/startups + "need crm" (70% min)
Expected: 10-20 high-quality leads
Action: Check if each lead mentions CRM needs
```

### Scenario 2: Multi-Subreddit
**Test if parallel searches work:**
```
Subreddits: startups, smallbusiness, SaaS
Keywords: need crm
Expected: Leads from all 3 subreddits shown
Action: Click stats → "Leads by Subreddit" to verify
```

### Scenario 3: Status Management
**Test if status updates work:**
```
1. Search for leads
2. Click on a lead card's dropdown
3. Change from "New" → "Contacted"
4. Refresh page
5. Expected: Status persists
```

### Scenario 4: Filtering
**Test if filter bar works:**
```
1. After search, select "All Leads" in dropdown
2. Expected: Shows leads from previous searches
3. Select "New Leads"
4. Expected: Only shows "new" status
5. Select "Contacted"
6. Expected: Shows leads you marked as "contacted"
```

---

## 📊 Monitor in Browser Console

Open DevTools (F12) and check:

**Network Tab:**
- POST `/api/reddit-leads/search` - Search request
- GET `/api/reddit-leads?status=new` - Fetch leads
- PATCH `/api/reddit-leads/:id` - Update status

**Console Tab:**
- Look for any errors (will be red)
- Should see clean logs with no warnings

---

## 🔍 Verify Database

### Option 1: psql (PostgreSQL CLI)
```bash
psql -U resiq -d resiq_crm
```

Then run:
```sql
\d reddit_leads  -- Show table structure
SELECT COUNT(*) FROM reddit_leads;  -- Count leads
SELECT * FROM reddit_leads LIMIT 1; -- View one lead
```

### Option 2: pgAdmin (if you have it)
```
Host: localhost
User: resiq
Password: resiq
Database: resiq_crm
```

Browse `reddit_leads` table in the GUI.

---

## 🐛 Common Issues & Fixes

### Issue: "ANTHROPIC_API_KEY not found"
```bash
# Fix: Verify it's in .env
cat .env | grep ANTHROPIC_API_KEY

# If missing, add it:
echo "ANTHROPIC_API_KEY=sk-ant-xxx" >> .env

# Restart server
npm run dev
```

### Issue: "Cannot find module '@anthropic-ai/sdk'"
```bash
# Fix: Install in server folder
cd server && npm install @anthropic-ai/sdk
cd ..
npm run dev
```

### Issue: "Database connection failed"
```bash
# Fix: Verify PostgreSQL is running
# On Mac: brew services start postgresql
# On Windows: Services → PostgreSQL → Start
# On Linux: sudo systemctl start postgresql

# Then run migrations
node run-all-migrations.js
```

### Issue: Search returns 0 leads
```bash
# Check if:
1. API key is valid (test at https://console.anthropic.com/)
2. Subreddit names are correct (e.g., "startups" not "r/startups")
3. Keywords are relevant (e.g., "need crm" for CRM product)
4. Server logs for errors (check terminal)
```

### Issue: UI doesn't show /reddit-leads page
```bash
# Fix: Check if route is registered
# Check client/src/App.jsx has:
import RedditLeads from './pages/RedditLeads'
<Route path="reddit-leads" element={<RedditLeads />} />

# If not there, verify the file was created:
ls client/src/pages/RedditLeads.jsx
```

---

## 📈 Performance Testing

### Test 1: Search Speed
```
Record time: npx is very fast (5-15 sec per search)
Expected: Shows "Searching..." for ~10 seconds
```

### Test 2: Database Performance
```
Insert 100 leads
Query filters on status
Expected: Sub-second response
```

### Test 3: UI Responsiveness
```
Display 100 leads in grid
Filter/sort operations
Expected: Smooth scrolling, fast filtering
```

---

## 🚀 Next Steps After Testing

Once you've verified:
- ✅ Searches return leads
- ✅ UI displays correctly
- ✅ Status management works
- ✅ Filtering/sorting works

### You can then:

1. **Refine keywords** based on your target market
2. **Test different subreddits** to find best sources
3. **Track conversion rate** from lead → customer
4. **Scale searches** to run weekly/daily
5. **Customize ranking** (which subreddits convert best)

---

## 📞 Need Help?

**Reference docs:**
- **REDDIT_LEADS_QUICKSTART.md** - 5-minute overview
- **REDDIT_LEADS.md** - Full technical documentation
- **REDDIT_LEADS_IMPLEMENTATION.md** - Architecture & examples

**Common commands:**
```bash
npm run dev                  # Start dev server
npm run install:all         # Install all deps
node run-all-migrations.js  # Run DB migrations
npm run build              # Build for production
```

---

## ✨ Your Dev Environment is Ready!

**Files created:**
- `.env` - Development configuration
- `DEV_SETUP.md` - This setup guide
- `REDDIT_LEADS.jsx` - React component
- `redditLeads.js` - API routes
- `redditMCPService.js` - Claude service
- `014-add-reddit-leads.sql` - Database migration

**Ready to test:**
1. `npm run install:all`
2. `node run-all-migrations.js`
3. Add API key to `.env`
4. `npm run dev`
5. Visit `http://localhost:5173/reddit-leads`

Good luck! Let me know if you hit any issues. 🚀
