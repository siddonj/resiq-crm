# Multi-Source Lead Finder - Debugging Guide

## Quick Diagnostics

The search is failing with message "Search failed". Here's how to diagnose:

### Step 1: Check Server Health

Open this in your browser:
```
http://localhost:5000/api/multi-source-leads/health
```

Should show:
```json
{
  "status": "ok",
  "database": "connected",
  "tableExists": true,
  "apiKeySet": true
}
```

**If `tableExists` is false**: Run migrations first
```bash
node run-all-migrations.js
```

**If `apiKeySet` is false**: ANTHROPIC_API_KEY not set in .env

---

### Step 2: Check Browser Console

Press **F12** to open Developer Tools, go to **Console** tab.

Look for errors like:
- `fetch failed` - Server not running
- `401 Unauthorized` - JWT token issue
- Network errors - Server not responding

---

### Step 3: Check Server Logs

When you click "Search Both Sources", watch the server terminal for logs like:
```
[MultiSourceLeads] Search request: { sources: ['reddit','linkedin'], ... }
[MultiSourceLeads] Starting search with configs: [...]
[MultiSourceLeadService] Searching Reddit r/startups
[MultiSourceLeadService] Reddit r/startups: found 3 leads
[MultiSourceLeadService] Searching LinkedIn for: need crm
[MultiSourceLeadService] LinkedIn: found 2 leads
[MultiSourceLeads] Search completed, found leads: 5
```

---

### Step 4: Common Errors & Fixes

#### Error: "Search failed" with no other details
- **Cause**: Check server logs for the actual error
- **Fix**: Restart server, check .env variables

#### Error: "relation "unified_leads" does not exist"
- **Cause**: Database migrations not run
- **Fix**: `node run-all-migrations.js` then restart server

#### Error: "ANTHROPIC_API_KEY not set"
- **Cause**: .env file missing ANTHROPIC_API_KEY
- **Fix**: Add valid key to .env and restart server

#### Error: "401 Unauthorized"
- **Cause**: JWT token expired or invalid
- **Fix**: Log out and log back in, check localStorage token

#### Error: "API Error" or timeout
- **Cause**: Claude API call failed (API key invalid, rate limit, etc)
- **Fix**: Check Anthropic dashboard, verify API key is valid

---

### Step 5: Manual API Test

Use curl or Postman to test the API directly:

```bash
# Get your JWT token from browser localStorage
# Then replace TOKEN below

curl -X POST http://localhost:5000/api/multi-source-leads/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "sources": ["reddit"],
    "subreddits": ["startups"],
    "keywords": ["need crm"],
    "minRelevance": 0.6
  }'
```

Check the response for actual error details.

---

### Step 6: Check .env Configuration

Make sure `.env` has:
```
ANTHROPIC_API_KEY=sk-ant-...         # Valid API key from Anthropic
DATABASE_URL=postgresql://resiq:resiq_dev@localhost:5434/resiq_crm
NODE_ENV=development
```

---

## Typical Success Flow

1. ✅ Server starts without errors
2. ✅ GET `/health` shows all true
3. ✅ Click "Search Both Sources"
4. ✅ Server logs show search progress
5. ✅ After 10-15 seconds, leads appear
6. ✅ Source icons (🔴 Reddit / 💼 LinkedIn) visible
7. ✅ Relevance scores displayed
8. ✅ Stats dashboard updates

---

## If Still Broken

Check these in order:

1. **Is dev server running?**
   ```bash
   npm run dev
   ```

2. **Is database running (Docker)?**
   ```bash
   docker-compose up -d
   ```

3. **Are all migrations applied?**
   ```bash
   node run-all-migrations.js
   ```

4. **Check package.json has all deps**
   ```bash
   npm install
   ```

5. **Is ANTHROPIC_API_KEY valid?**
   - Visit https://console.anthropic.com/
   - Check API usage and rate limits
   - Generate new key if needed
   - Update .env and restart server

---

## Performance Notes

- First search: 15-20 seconds (Claude thinking)
- Subsequent searches: 10-15 seconds (cached knowledge)
- Each search calls Claude 2x (Reddit + LinkedIn)
- Cost: ~$0.003 per search
- Rate limits: 10 RPM (requests per minute) standard plan

If searches timeout after 30s, Claude may be slow or API key may have issue.
