# Reddit Lead Finder - Implementation Guide

## Overview

The Reddit Lead Finder uses Claude AI (via Anthropic API) and MCP (Model Context Protocol) to automatically discover and qualify business leads from Reddit discussions. Instead of building a marketplace, this focused solution directly integrates Reddit insights into ResiQ.

## Architecture

```
Reddit (public discussions)
  ↓
Claude AI (via Anthropic API)
  ↓ (MCP communication)
  ↓
RedditMCPService (server-side)
  ↓
Database (reddit_leads table)
  ↓
RedditLeads UI (React component)
  ↓
Sales team (qualified leads)
```

## Features

### 1. **Automatic Lead Discovery**
- Search multiple subreddits simultaneously (startups, smallbusiness, SaaS, entrepreneur, etc.)
- Extract relevant discussions mentioning pain points (CRM, sales tracking, client management, etc.)
- AI-powered relevance scoring (0-1 scale)
- Identify contact information (emails, LinkedIn hints)

### 2. **Intelligent Lead Scoring**
- **Relevance Score**: 0-1 rating based on how well the post matches your keywords
- **Pain Points**: Automatically extracted from discussion content
- **Business Signals**: Indicators of buying intent (hiring, scaling, urgency)
- **Lead Quality**: High/Medium/Low classification

### 3. **Lead Management**
- View all discovered leads in a beautiful card-based interface
- Filter by status (New, Contacted, Converted, Rejected)
- Sort by relevance, discovery date, or subreddit
- Update lead status as you engage
- Track contact information

### 4. **Statistics Dashboard**
- Total leads discovered
- New leads awaiting action
- Contacted and converted count
- Average relevance score
- Breakdown by subreddit

## Database Schema

### reddit_leads
Stores discovered leads with relevance scoring and tracking

```sql
id, reddit_id, author, post_title, post_url, subreddit
post_content, relevance_score, lead_keywords
contact_email, contact_name, source_type
status (new|contacted|converted|rejected|spam)
notes, discovered_at, created_at, updated_at
```

### reddit_search_configs
Tracks monitored subreddits and keywords

```sql
id, subreddit, keywords (JSONB)
enabled, last_sync, sync_frequency_minutes
min_relevance_score, created_at, updated_at
```

### reddit_search_results
History of all searches performed

```sql
id, config_id, search_query, results_count
high_relevance_count, sync_started_at, sync_completed_at
status, error_message, created_at
```

## API Endpoints

### Search for Leads
**POST** `/api/reddit-leads/search`
```json
{
  "subreddits": ["startups", "smallbusiness", "SaaS"],
  "keywords": ["need crm", "looking for crm", "crm solution"],
  "minRelevance": 0.5
}
```

**Response:**
```json
{
  "success": true,
  "discovered": 45,
  "stored": 38,
  "leads": [...]
}
```

### Get All Leads
**GET** `/api/reddit-leads?status=new&minRelevance=0.5&limit=50&offset=0`

**Response:**
```json
{
  "leads": [...],
  "total": 156,
  "count": 50,
  "limit": 50,
  "offset": 0
}
```

### Get Single Lead
**GET** `/api/reddit-leads/:id`

### Update Lead Status
**PATCH** `/api/reddit-leads/:id`
```json
{
  "status": "contacted",
  "notes": "Sent initial email",
  "contact_email": "john@example.com",
  "contact_name": "John Smith"
}
```

### Delete/Reject Lead
**DELETE** `/api/reddit-leads/:id`

### Get Statistics
**GET** `/api/reddit-leads/stats/summary`
```json
{
  "total_leads": 256,
  "new_leads": 45,
  "contacted_leads": 120,
  "converted_leads": 8,
  "avg_relevance": 0.67,
  "latest_discovery": "2026-04-26T02:15:00Z"
}
```

**GET** `/api/reddit-leads/stats/by-subreddit`
```json
[
  {
    "subreddit": "startups",
    "total": 89,
    "new_count": 12,
    "avg_relevance": 0.72
  },
  ...
]
```

### List Search Configs
**GET** `/api/reddit-leads/configs/list`

### Update Search Config
**PATCH** `/api/reddit-leads/configs/:id`

## How to Use

### 1. Install Dependencies

```bash
npm install @anthropic-ai/sdk
```

This is required for Claude API integration.

### 2. Set Environment Variables

Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
```

Get your API key from: https://console.anthropic.com/

### 3. Run Migrations

```bash
node run-all-migrations.js
```

This creates the `reddit_leads`, `reddit_search_configs`, and `reddit_search_results` tables.

### 4. Access the UI

Navigate to `/reddit-leads` in the app. You'll see:

- **Stats Dashboard**: Overview of all discovered leads
- **Subreddit Breakdown**: Leads by source (r/startups, r/smallbusiness, etc.)
- **Search Panel**: Configure subreddits and keywords to search
- **Lead Cards**: Grid view of all leads with relevance scores and actions

### 5. Search for Leads

1. In the Search Panel, add subreddits (e.g., `startups, smallbusiness, SaaS`)
2. Add keywords (e.g., `need crm, looking for crm, crm solution`)
3. Adjust minimum relevance score (0-100%)
4. Click "🚀 Search Reddit"
5. System discovers leads and shows results

### 6. Manage Leads

For each lead card:
- **View Details**: Click post title to see full discussion on Reddit
- **Change Status**: Dropdown to mark as Contacted, Converted, or Rejected
- **Add Email**: Extracted or manually entered contact email
- **Delete**: Mark as spam/rejected
- **View Author**: Click r/subreddit to see author's profile

## Example Workflow

```
1. User searches r/startups for "need crm"
   → System finds 23 discussions mentioning CRM needs
   
2. Claude AI analyzes each discussion:
   - "We're growing from 5→15 people and need a CRM" → Score: 0.85
   - "What's the best CRM?" → Score: 0.72
   - "CRM is killing our efficiency" → Score: 0.68
   
3. System stores leads with:
   - Author: john_smith, jane_doe, etc.
   - Keywords matched: ['CRM', 'growing', 'efficiency']
   - Pain points: ['scaling', 'team growth', 'process automation']
   - Status: new
   
4. Sales rep reviews leads:
   - Contacts top 3 (relevance > 0.8)
   - Marks others as "contacted" or "rejected"
   
5. Conversion:
   - Rep closes deal with john_smith
   - Marks lead as "converted"
   - System tracks ROI (cost per lead acquired)
```

## Key Components

### RedditMCPService (`server/src/services/redditMCPService.js`)

**Main Methods:**

- `searchRedditForLeads(subreddit, keywords, options)` - Search single subreddit
- `searchMultipleSubreddits(configs)` - Search multiple subreddits in parallel
- `analyzePostRelevance(content, keywords)` - Score post relevance
- `extractContactInfo(author, content)` - Extract email/contact hints

### RedditLeads Route (`server/src/routes/redditLeads.js`)

**Endpoints:**

- `POST /search` - Trigger Reddit search
- `GET /` - Fetch all leads with filters
- `GET /:id` - Get single lead details
- `PATCH /:id` - Update lead status
- `DELETE /:id` - Mark lead as rejected
- `GET /stats/summary` - Overall statistics
- `GET /stats/by-subreddit` - Breakdown by subreddit

### RedditLeads Component (`client/src/pages/RedditLeads.jsx`)

**Features:**

- Search configuration (subreddits, keywords, min relevance)
- Stats dashboard with key metrics
- Subreddit breakdown visualization
- Lead card grid with relevance scoring
- Status management (New, Contacted, Converted, Rejected)
- Contact information display

## Performance Considerations

### Search Speed
- Each subreddit search takes ~5-15 seconds (Claude processing time)
- Multiple subreddits searched in parallel
- Results cached by Reddit ID to avoid duplicates

### Database Optimization
- Indexed by: status, subreddit, relevance_score, author, discovered_at
- Queries filtered before returning to reduce payload
- JSONB indexes for lead_keywords

### Claude API Costs
- ~$0.003 per search (depends on response length)
- Relevant filtering reduces unnecessary processing
- Consider batch searches during off-peak hours

## Customization

### Add New Subreddits

Edit `RedditMCPService.DEFAULT_CONFIGS`:
```javascript
{
  subreddit: 'webdev',
  keywords: ['client management', 'project tracking', 'customer portal'],
}
```

### Adjust Relevance Thresholds

In UI or via API:
```javascript
minRelevance: 0.6  // Only show 60%+ relevance leads
```

### Custom Keywords

Change search keywords based on target market:
- SaaS: ['crm', 'sales automation', 'customer engagement']
- Freelance: ['client management', 'invoicing', 'time tracking']
- Agencies: ['project tracking', 'workflow automation']

## Troubleshooting

### "Cannot find module '@anthropic-ai/sdk'"
```bash
npm install @anthropic-ai/sdk
```

### "ANTHROPIC_API_KEY not found"
- Check `.env` has `ANTHROPIC_API_KEY=sk-ant-xxx`
- Ensure `.env` is loaded before starting server
- Get key from: https://console.anthropic.com/

### Search returns no leads
- Check subreddit name is correct (without 'r/')
- Verify keywords are relevant to target audience
- Increase `minRelevance` threshold
- Try broader keywords first

### Leads not storing in database
- Run migrations: `node run-all-migrations.js`
- Check database connection in `DB_URL`
- Verify `reddit_leads` table exists: `\d reddit_leads` (psql)

## Future Enhancements

- **Scheduled Searches**: Auto-run searches on schedule (hourly/daily)
- **Lead Enrichment**: Lookup company info, funding, employees
- **Auto-Qualification**: ML model to auto-qualify leads
- **Lead Assignment**: Auto-assign to sales rep based on territory
- **Follow-up Automation**: Auto-send cold emails to qualified leads
- **Sentiment Analysis**: Gauge buying urgency from discussion tone
- **Competitor Analysis**: Monitor what people say about competitors
- **Custom Workflows**: Trigger actions on high-relevance leads
- **Multi-source**: Extend to LinkedIn, GitHub, ProductHunt, etc.

## API Rate Limits

- Claude API: 100,000 tokens/minute (included tier)
- Reddit: Rate limited by IP (generous for non-commercial use)
- ResiQ: No built-in rate limits on lead discovery endpoint

## Privacy & Compliance

- Only uses **public** Reddit discussions
- Respects Reddit's terms of service (no scraping, API-based search)
- No personal data collection beyond what's publicly posted
- Stores author name and post URL for reference
- Users control which subreddits are searched

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review API response error messages
3. Check server logs for detailed errors
4. Verify `.env` variables are set
5. Ensure database migrations ran successfully

---

**Last Updated:** 2026-04-26  
**Version:** 1.0  
**Status:** Production Ready
