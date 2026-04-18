# ResiQ CRM — Feature Roadmap

## Completed

- **Phase 1–3** — Core CRM: contacts, deals/pipeline (kanban), auth
- **Phase 4** — Sales dashboard with analytics
- **Phase 5** — Role-based access control (admin, manager, user, viewer)
- **Phase 6** — Teams & team membership
- **Phase 7** — Audit logs
- **Phase 8** — Resource sharing between users
- **Phase 9** — Reminders, activity logging, search/filter, settings, CSV exports

---

## Upcoming

### Phase 10 — Proposals
Proposal builder tied to deals. Templates with sections (scope, deliverables, pricing table with line items). Status lifecycle: `draft → sent → viewed → signed → declined`. HTML preview + PDF download. Inline e-signature (typed name + timestamp, no third-party required for v1). Proposal page linked from the deal detail.

### Phase 11 — Invoicing
Invoice generation from a proposal or from scratch. Line items with quantity, rate, tax, and discount. Status: `draft → sent → paid → overdue`. Stripe integration for online payment links. PDF download. Automated overdue reminders via the existing reminders system.

### Phase 12 — Time Tracking
Time entries logged against a contact or deal — manual entry or start/stop timer. Billable flag per entry. Time report per deal showing total hours × rate. "Convert to invoice" button that pre-fills invoice line items from logged time. Bridges doing the work and billing for it.

### Phase 13 — Calendar & Scheduling
Calendar view (monthly/weekly) rendering activities and reminders. Google Calendar OAuth sync (read + write). Public scheduling page (`/book/[username]`) where clients pick available slots — automatically creates an activity and reminder on booking.

### Phase 14 — Client Portal
Separate auth flow for clients (invite by email, passwordless until they set one). Client-facing view: proposals (sign), invoices (pay), project status, shared files. Reuses Stripe from Phase 11 and e-signature from Phase 10.

### Phase 15 — SMS
Twilio integration for two-way SMS. Messages logged as activities on the contact. Opt-out handling. SMS templates for common messages (proposal sent, invoice due, meeting reminder).
