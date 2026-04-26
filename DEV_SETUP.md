# Reddit Lead Finder - Dev Setup Commands

## Run these commands in order to start testing:

### 1. Install Dependencies
npm run install:all

### 2. Run Migrations (creates database tables)
node run-all-migrations.js

### 3. Set Your Anthropic API Key
# Option A: Add to .env (already created)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx

# Option B: Get a free key at:
# https://console.anthropic.com/
# (Free tier includes $5 credit = 1,600+ searches)

### 4. Start Development Server
npm run dev

This will start:
- Backend server on http://localhost:5000
- Frontend on http://localhost:5173 (or 3000)

### 5. Access Reddit Lead Finder
Navigate to: http://localhost:5173/reddit-leads

---

## What to Do Next

1. **Open http://localhost:5173/reddit-leads** in your browser
2. **Search for leads:**
   - Subreddits: startups
   - Keywords: need crm
   - Min Relevance: 70%
3. **Click "🚀 Search Reddit"**
4. **Wait 5-15 seconds** for Claude to analyze posts
5. **See results** in beautiful card grid

---

## Troubleshooting

If migrations fail:
  - Make sure PostgreSQL is running
  - Check DATABASE_URL in .env
  - Run: psql -U resiq -d resiq_crm (test connection)

If API key is missing:
  - Get free key: https://console.anthropic.com/
  - Add to .env: ANTHROPIC_API_KEY=sk-ant-xxx
  - Restart server

If npm install fails:
  - Try: npm cache clean --force
  - Then: npm run install:all

---

Run these in your terminal now!
