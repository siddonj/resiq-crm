# HubSpot Equivalence Expansion Plan

This plan aims to close the functional gaps between ResiQ CRM and HubSpot's ecosystem (Marketing, Sales, Service, and Operations Hubs) by introducing automated, AI-driven, and scalable processes tailored heavily toward a one-person organization.

---

## Phase 16: Inbound Marketing & Lead Capture (HubSpot Marketing Hub)
**Goal:** Automate top-of-funnel lead generation directly from your website properties.

*   **16.1 Web-to-Lead Forms API:** Create a public API endpoint (`POST /api/leads`) that accepts form submissions from external websites.
*   **16.2 Form Builder UI:** Add a "Forms" module in the Settings where you can define custom fields mapped to your Contact and Deal schemas.
*   **16.3 Embed Snippet Generation:** Generate an embeddable `<script>` or HTML widget that renders the form on WordPress, Webflow, or Squarespace.
*   **16.4 Auto-Routing:** When a form is submitted, automatically spawn a Contact, open a Deal in the 'Lead' stage, and log the submission source.

## Phase 17: AI Auto-Enrichment (HubSpot Operations Hub / Clearbit)
**Goal:** Never manually research a company again. When a lead enters the CRM, AI does the background check.

*   **17.1 Enrichment Agent Queue:** Create a new Bull worker (`enrichmentWorker.js`) triggered instantly when a new Contact is added to the system via the Web-to-Lead form (Phase 16).
*   **17.2 Scraping Integration:** Connect a tool like Firecrawl or Puppeteer to navigate to the company's domain.
*   **17.3 LLM Extraction:** Feed the scraped website data to OpenAI to extract metrics (Estimated Size, Core Business, Competitors, and Technology Stack).
*   **17.4 CRM Update:** The agent automatically updates the Contact's `notes` and `service_line` fields without any human intervention.

## Phase 18: Drip Campaigns & Sequences (HubSpot Sales Hub)
**Goal:** Automate multi-touch outreach so no lead "falls through the cracks."

*   **18.1 Sequence Schema:** Design database tables for `sequences` and `sequence_steps` (e.g., Step 1: Email, Step 2: Delay 3 Days, Step 3: SMS).
*   **18.2 Workflow Engine Upgrade:** Update the existing visual `WorkflowEngine` to support "Delay/Wait" nodes.
*   **18.3 Campaign Execution:** Create a CRON job (using Bull) that wakes up daily to check which sequence steps are due, and automatically fires the Gmail integration or Twilio SMS integration you built previously.
*   **18.4 Auto-Pause on Reply:** Enhance the `emailSyncWorker` so that if an inbound email is detected from the Contact, it automatically pauses any active outbound sequences.

## Phase 19: Engagement Tracking (HubSpot Sales Intelligence)
**Goal:** Know exactly when a prospect opens your assets to time your outreach perfectly.

*   **19.1 Pixel Generation:** Serve a transparent 1x1 image pixel via Express (`GET /api/track/:id.png`).
*   **19.2 Email Injection:** Inject the tracking pixel automatically into outgoing sequence emails and regular manual outreach.
*   **19.3 Proposal & Invoice Tracking:** Track `opened` events on the public-facing proposal signing and invoice payment links.
*   **19.4 Activity Timeline:** When tracking events fire, log them to the `activities` table so you see "Proposal Opened" on the Contact's CRM timeline.
*   **19.5 Live Notifications:** (Optional) Hook up a WebSocket to ping your frontend dashboard with a toast notification when a high-value action occurs.

## Phase 20: Client Support & Ticketing (HubSpot Service Hub)
**Goal:** Centralize post-sale communication and protect your main inbox from support noise.

*   **20.1 Tickets Schema:** Create a `tickets` table (Subject, Status, Priority, Assigned Contact).
*   **20.2 Client Portal Integration:** Allow active clients logging into your Phase 14 Client Portal to submit Help Desk tickets directly into your CRM.
*   **20.3 Help Desk UI:** Add a new Kanban board specifically for Support Tickets inside the Employee Portal.
*   **20.4 AI Auto-Response:** Optionally connect an agent to intercept incoming tickets, search past proposals/notes, and draft a suggested reply before you even see it.

---

### The Path Forward
For a one-person organization, **Phase 17 (Auto-Enrichment)** and **Phase 18 (Drip Campaigns)** provide the highest immediate ROI by radically multiplying your sales velocity without adding manual data entry overhead.