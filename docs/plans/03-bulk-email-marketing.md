# Bulk Email Marketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add bulk email marketing capabilities — rich HTML email templates, contact list segmentation, and scheduled/triggered email campaigns with open/click tracking.

**Architecture:** New database tables, new routes/UI for campaign management, reuse existing GmailService for sending, new Bull worker for scheduled sends. Open tracking via existing `/api/track` pixel endpoint.

**Tech Stack:** Bull, existing GmailService (gmail.send scope already granted), Kysely, React, Tailwind.

---

## Files

**Server:**
- Create: `server/src/routes/emailCampaigns.js` — Campaign CRUD + send endpoints
- Create: `server/src/services/emailCampaignService.js` — Business logic
- Create: `server/src/workers/emailCampaignWorker.js` — Scheduled send worker
- Modify: `server/src/index.js` — Register routes + init worker

**Client:**
- Create: `client/src/pages/EmailCampaigns.jsx` — Campaign list + editor
- Create: `client/src/components/EmailTemplateEditor.jsx` — Rich HTML editor
- Modify: `client/src/App.jsx` — Add route

**Database:**
- Create: `database/migrations/046_email_campaigns.sql`

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_id UUID REFERENCES email_templates(id),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','paused','cancelled')),
  schedule_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  segment_filter JSONB, -- { tags: [...], types: [...], service_lines: [...] }
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  open_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','opened','clicked')),
  tracking_id UUID DEFAULT gen_random_uuid(),
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  error TEXT,
  UNIQUE(campaign_id, contact_id)
);
```

## Tasks

### Task 1: Create email campaign service

- [ ] **Step 1:** Create `emailCampaignService.js` with:
  - `createCampaign(userId, data)` — Creates campaign + resolves segment into recipients
  - `scheduleCampaign(campaignId, scheduleAt)` — Queues Bull job
  - `sendCampaign(campaignId)` — Iterates recipients, sends via GmailService.sendEmail with tracking pixel
  - `getCampaignStats(campaignId)` — Aggregated stats
  - `getRecipientSegment(userId, filter)` — Queries contacts matching filter

- [ ] **Step 2:** Create the service with tracking pixel support

Tracking pixel URL format: `https://crm.resiq.co/api/track/o?cid={campaignId}&rid={recipientId}&t=email`

Email HTML gets `<img src="...tracking pixel..." />` appended, and links get wrapped with click tracking redirect.

### Task 2: Create campaign routes

- [ ] **Step 1:** Create `emailCampaigns.js` with:
  - `GET /api/email-campaigns` — List campaigns
  - `POST /api/email-campaigns` — Create campaign
  - `GET /api/email-campaigns/:id` — Get campaign with stats
  - `PATCH /api/email-campaigns/:id` — Update campaign
  - `POST /api/email-campaigns/:id/send` — Send immediately
  - `POST /api/email-campaigns/:id/schedule` — Schedule send
  - `POST /api/email-campaigns/:id/pause` — Pause sending
  - `GET /api/email-campaigns/templates` — List templates
  - `POST /api/email-campaigns/templates` — Create template
  - `DELETE /api/email-campaigns/:id` — Delete campaign

### Task 3: Create campaign worker

- [ ] **Step 1:** Create `emailCampaignWorker.js` — Bull worker that picks up scheduled campaigns and processes sends with rate limiting (max 50/hr to stay under Gmail quota)

### Task 4: Build campaign UI

- [ ] **Step 1:** Create `EmailCampaigns.jsx` page with:
  - Campaign list table (name, status, sent/total, open rate)
  - Create/edit campaign form
  - Template editor (basic HTML editor with variables: `{{contact.name}}`, `{{contact.company}}`)
  - Segment picker (tag selector, type filter)
  - Send/schedule controls

- [ ] **Step 2:** Register route in `App.jsx` at `/email-campaigns`

### Task 5: Wire up and deploy

- [ ] **Step 1:** Register routes + worker in `index.js`
- [ ] **Step 2:** Apply migration to VPS
- [ ] **Step 3:** Deploy and verify

---

## Edge Cases & Pitfalls

1. **Gmail send limits** — 500 emails/day per Google account. Worker must enforce daily quota and throttle.
2. **Bounced emails** — Need to track failures and suppress future sends.
3. **Unsubscribe** — Every campaign email must include an unsubscribe link: `https://crm.resiq.co/api/track/unsubscribe?rid={recipientId}`
4. **HTML rendering** — Gmail strips most CSS. Templates should use inline styles (MJML-like approach recommended).
