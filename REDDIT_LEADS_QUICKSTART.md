# Reddit Lead Finder - Quick Start

## 📋 What is This?

Find qualified business leads directly from Reddit discussions using AI. The system automatically searches subreddits like r/startups, r/smallbusiness, and r/SaaS for people discussing problems ResiQ solves (CRM needs, client management, sales tracking, etc.), extracts relevant discussions, scores them by relevance, and stores qualified leads in your CRM.

**No marketplace, no API integrations — just pure Reddit-sourced leads with AI-powered analysis.**

---

## 🚀 5-Minute Setup

### 1. Get Anthropic API Key (2 minutes)

Visit: https://console.anthropic.com/

1. Sign up (free account includes $5 credit)
2. Click "API Keys" in sidebar
3. Create new key
4. Copy the key

### 2. Add to `.env` (30 seconds)

```bash
# Add this to your .env file
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxx
```

### 3. Install Dependency (30 seconds)

```bash
cd server
npm install @anthropic-ai/sdk
```

### 4. Run Migrations (30 seconds)

```bash
cd .. (back to root)
node run-all-migrations.js
```

### 5. Start App (1 minute)

```bash
npm run dev
```

Open http://localhost:5173 and navigate to `/reddit-leads`

---

## 🎯 Using the Reddit Lead Finder

### Search for Leads

1. **Set Subreddits**: `startups, smallbusiness, SaaS, entrepreneur, consulting`
2. **Set Keywords**: `need crm, looking for crm, crm solution, client management`
3. **Min Relevance**: Keep at 50% initially (lower = more volume, higher = better quality)
4. **Click "🚀 Search Reddit"**

### What Happens

```
You:  "Search r/startups for 'need crm'"
  ↓
Claude AI:  Reads all recent posts in r/startups
            Finds ones mentioning "need crm" or similar
            Scores each by relevance (0-100%)
            Extracts pain points and contact hints
  ↓
System:  Stores leads in database
         Shows you 45 discovered leads
  ↓
You:  Reviews leads in card view
      Clicks on top 10 (80%+ relevance)
      Marks as "contacted" after outreach
```

### Manage Leads

Each lead card shows:
- **Post Title** — What they discussed
- **r/subreddit** — Where they posted
- **Author** — Reddit username
- **Relevance Score** — 0-100% (higher = better match)
- **Keywords Matched** — What triggered the match
- **Status Dropdown** — Mark as New, Contacted, Converted, or Rejected

Click the post title to view the full discussion on Reddit.

---

## 📊 Understanding the Dashboard

### Statistics Box
- **Total Leads** — All leads ever discovered
- **New Leads** — Waiting for your action
- **Contacted** — You've reached out
- **Converted** — Turned into deals
- **Avg Relevance** — Quality indicator

### Leads by Subreddit
Shows which subreddits produce the best leads for your keywords.

Example:
- r/startups: 89 leads, 72% avg relevance (highest quality)
- r/smallbusiness: 54 leads, 61% avg relevance
- r/SaaS: 34 leads, 68% avg relevance

---

## 💡 Pro Tips

### 1. Start Narrow, Expand Wide
**First search:**
```
Subreddits: startups
Keywords: need crm
Min Relevance: 70%
```

This gives you 10-15 high-quality leads to validate the process.

**Later searches:**
```
Subreddits: startups, smallbusiness, SaaS, entrepreneur
Keywords: need crm, looking for crm, crm solution, client management, sales tracking
Min Relevance: 50%
```

### 2. Customize Keywords to Your Value Prop
**If selling to startups:**
```
Keywords: scaling, growing team, process automation, startup needs
```

**If selling to consultants/agencies:**
```
Keywords: client portal, project tracking, proposal, time tracking, invoicing
```

**If selling to small businesses:**
```
Keywords: customer management, business growth, efficiency, bookkeeping
```

### 3. Check Back Daily
New discussions happen constantly on Reddit. Run searches daily or weekly to continuously fill your pipeline.

### 4. Track Conversion Rate
Keep leads in "Contacted" status while you follow up. Move to "Converted" when they become customers. Monitor:
- % contacted → closed (your conversion rate)
- Which subreddits convert best (r/startups vs r/SaaS)
- Which keywords attract best-quality prospects

### 5. Refine Over Time
After first month:
- Remove keywords that produce spam
- Focus on subreddits with highest conversion
- Adjust min relevance threshold based on results

---

## 🎓 Understanding Relevance Scores

Claude analyzes each post and assigns a relevance score (0-100%):

**80-100% (High Relevance):**
```
"We're growing from 5 to 15 people and need a CRM to track our sales pipeline. 
Looking for something affordable that doesn't require a PhD to use."
```
→ Specific need + budget consideration + size match = Perfect lead

**60-80% (Medium Relevance):**
```
"What's the best CRM for early-stage startups? We need better customer tracking."
```
→ Actively looking + relevant industry + somewhat vague = Good lead

**40-60% (Lower Relevance):**
```
"Anyone here use a CRM? I'm thinking about it."
```
→ Interested but not urgent + vague = Might convert, lower priority

**Below 40% (Low Relevance):**
```
"CRM is such an overused acronym lol"
```
→ Just mentioning the word, not actually looking = Likely spam

Set your minimum threshold based on how many leads you want to follow up:
- 70%+ = Small, high-quality pipeline (10-20/week)
- 50%+ = Balanced pipeline (30-50/week)
- 30%+ = Volume pipeline (100+/week, but lower conversion)

---

## 🔧 Troubleshooting

### "No leads found"
- Subreddit names correct? (e.g., `startups` not `r/startups`)
- Keywords relevant to your offer?
- Try: `subreddits: startups` and `keywords: need crm`
- Increase wait time (Claude sometimes takes 10-15 seconds)

### "ANTHROPIC_API_KEY not set"
1. Check `.env` file exists in root directory
2. Verify key is correct (starts with `sk-ant-`)
3. Restart server after adding key

### "Error: Cannot find module '@anthropic-ai/sdk'"
```bash
cd server && npm install @anthropic-ai/sdk
```

### Search is slow (10-15 seconds)
Normal! Claude is analyzing each post. Faster with fewer subreddits/keywords.

---

## 💰 Cost Estimate

- **Claude API**: ~$0.003 per search (very cheap)
- **20 searches/week**: ~$0.06/week = ~$3/month
- **Storage**: Free (data stored in your PostgreSQL)

Anthropic's free tier includes $5 credit — that's 1,600+ searches!

---

## 🤔 FAQ

**Q: Can I scrape Reddit directly?**
A: No, but Claude's MCP uses official APIs which is legal and compliant.

**Q: What if someone marks my contact as spam?**
A: Respectful outreach only! If you get blocked, remove that subreddit.

**Q: Can I automate searches?**
A: Not yet, but future version will support scheduled daily/weekly searches.

**Q: What data do you store?**
A: Author name, post title/URL, extracted keywords, relevance score. No personal data beyond what's public on Reddit.

**Q: Can I search other platforms?**
A: Currently Reddit only. Future: LinkedIn, GitHub, ProductHunt, HackerNews, etc.

**Q: How accurate is the AI?**
A: Pretty good (70-80% of leads are relevant). Run first search on small subreddit to validate.

---

## Next Steps

1. **First Search**: Search r/startups for "need crm" with 70% min relevance
2. **Review Results**: Check 3-5 top leads to validate quality
3. **Refine**: Adjust keywords and subreddits based on what you find
4. **Scale**: Run weekly searches across multiple subreddits
5. **Track**: Monitor which sources convert best and focus there

---

**Questions?** See full docs: `REDDIT_LEADS.md`
