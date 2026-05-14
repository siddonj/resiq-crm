import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

const QUICK_START = [
  {
    step: 1,
    icon: '👤',
    title: 'Add your contacts',
    desc: 'Go to Contacts → "+ Add Contact". Fill in name, email, phone, and company. Use tags to keep things organized from day one.',
  },
  {
    step: 2,
    icon: '📊',
    title: 'Build your pipeline',
    desc: 'Go to Pipeline → "+ New Deal". Assign a contact, set a stage and value. Drag cards between columns as deals progress.',
  },
  {
    step: 3,
    icon: '📁',
    title: 'Create a project',
    desc: 'Go to Projects → "+ New Project". Name it, add members, and set up columns. Use Grid, Kanban, Gantt, Calendar, or Sprint views to manage work.',
  },
  {
    step: 4,
    icon: '📄',
    title: 'Send a proposal',
    desc: 'Go to Proposals → "+ New Proposal". Add line items, preview, and send. Clients can view and e-sign from their portal.',
  },
  {
    step: 5,
    icon: '⚡',
    title: 'Run outbound automation',
    desc: 'Go to Outbound → Execution. Build campaigns, sequences, and workflow rules, then use Leads and Data workspaces for operations.',
  },
]

const FEATURES = [
  {
    icon: '👥',
    title: 'Contacts',
    desc: 'Central record for every person and company you work with — including activity history, emails, SMS, deals, and files.',
    tip: 'Use tags to segment by service type so you can filter and bulk-message specific groups.',
  },
  {
    icon: '📋',
    title: 'Pipeline',
    desc: 'Kanban-style deal tracking. Drag deals between stages, track value at each stage, and spot bottlenecks at a glance.',
    tip: 'Set a close date on every deal — they surface in Reminders so nothing slips.',
  },
  {
    icon: '📝',
    title: 'Proposals',
    desc: 'Build line-item proposals, preview them, and send. Clients get a dedicated link to view and e-sign from their portal.',
    tip: 'Convert an accepted proposal to an invoice in one click from the proposal detail page.',
  },
  {
    icon: '💰',
    title: 'Invoices',
    desc: 'Create and send invoices, accept Stripe payments, and track paid vs. outstanding balances per client.',
    tip: 'Connect Stripe so clients can pay directly from their portal — no back-and-forth needed.',
  },
  {
    icon: '💬',
    title: 'SMS',
    desc: 'Two-way SMS with contacts. Full conversation threads per contact, plus templates and automated messages.',
    tip: 'Build templates with {{name}} and {{company}} variables to personalize bulk messages quickly.',
  },
  {
    icon: '📬',
    title: 'Sequences',
    desc: 'Drip email campaigns. Enroll contacts and emails send automatically over your chosen schedule.',
    tip: 'Manage sequences in Outbound → Execution, then enroll contacts from Outbound → Leads.',
  },
  {
    icon: '⚡',
    title: 'Workflows',
    desc: 'Trigger automated actions — send SMS, create reminders, enroll in sequences — when deals or contacts change.',
    tip: 'Workflow rules now live in Outbound → Execution so campaign and sequence logic stays in one place.',
  },
  {
    icon: '📅',
    title: 'Calendar',
    desc: 'View and schedule meetings. Sync with Google Calendar for a unified view across tools.',
    tip: 'Connect Google Calendar so meetings booked externally appear in the CRM automatically.',
  },
  {
    icon: '⏱️',
    title: 'Time Tracking',
    desc: 'Log time against deals and contacts. Mark entries billable to pull them straight into invoices.',
    tip: 'Use the live timer during calls — it records exact start and end time so nothing gets missed.',
  },
  {
    icon: '🤖',
    title: 'AI Agents',
    desc: 'Research prospects, find contact details, and generate talking points using AI — in bulk or one at a time.',
    tip: 'Run a prospecting job on a list of company names to enrich them with emails and LinkedIn profiles.',
  },
  {
    icon: '🌐',
    title: 'Web Forms',
    desc: 'Embed lead capture forms on your website. Submissions land directly in Contacts, ready for follow-up.',
    tip: 'Pair a web form with a workflow: new submissions auto-enroll in a nurture sequence with zero manual work.',
  },
  {
    icon: '🔐',
    title: 'Client Portal',
    desc: 'Clients get their own secure login to view proposals, invoices, and files you share with them.',
    tip: 'Invite clients from Settings → Accounts. They get an email link to set their password and log in.',
  },
  {
    icon: '📁',
    title: 'Projects & Tasks',
    desc: 'Full project management with Grid, Kanban, Gantt, Calendar, Sprint, and Team Planner views. Tasks support parent/child hierarchy, custom columns, and bulk operations.',
    tip: 'Use indent/outdent arrows to create subtasks. Progress rolls up automatically from children to parents.',
  },
  {
    icon: '🏷️',
    title: 'Work Package Types',
    desc: 'Define task types per project (Task, Milestone, Bug, Epic) with colors and icons. Types drive workflow-aware status transitions.',
    tip: 'Set up workflows so reps can only move tasks through allowed status transitions — no accidental skips.',
  },
  {
    icon: '🔗',
    title: 'Task Relations',
    desc: 'Link tasks with precedes, follows, blocks, blocked_by, duplicates, relates_to, and part_of relationships. Cycle detection prevents circular dependencies.',
    tip: 'Use "blocks" / "blocked_by" to surface blockers in task detail panels before work starts.',
  },
  {
    icon: '⏱️',
    title: 'Task Time Tracking',
    desc: 'Log time directly against tasks. Spent hours roll up to parent tasks automatically via PostgreSQL triggers. Track billable vs non-billable entries.',
    tip: 'Watch the spent vs estimated progress bar in TaskDetail — it turns red when you go over budget.',
  },
  {
    icon: '📋',
    title: 'Project Templates',
    desc: 'Save any project as a template and clone it for new engagements. Copies columns, views, types, workflows, and optionally task skeletons.',
    tip: 'Create a "Standard Installation" template with all phases and task types pre-configured for faster project kickoffs.',
  },
  {
    icon: '🏃',
    title: 'Agile Boards / Sprints',
    desc: 'Plan sprints with goals and dates. Assign story points, move tasks between sprint columns, and track burndown and velocity.',
    tip: 'Use the Backlog view to groom unassigned tasks before pulling them into the next sprint.',
  },
  {
    icon: '👥',
    title: 'Team Planner',
    desc: 'Visual workload grid showing each team member\'s daily allocation percentage. Green under 80%, amber 80-100%, red over 100%.',
    tip: 'Schedule tasks with start/end dates and allocation % to spot over-allocation before it becomes a bottleneck.',
  },
  {
    icon: '📸',
    title: 'Baseline Comparison',
    desc: 'Save project snapshots and compare current state against any baseline. See added, removed, and changed tasks with field-level diffs.',
    tip: 'Save a baseline at project kickoff to track scope creep and schedule drift over time.',
  },
  {
    icon: '📍',
    title: 'Project Life Cycle Phases',
    desc: 'Define sequential project phases with deliverables and gate approvals. Phase timeline shows progress at a glance in the project header.',
    tip: 'Require gate approval before a phase can be marked complete — great for quality control checkpoints.',
  },
  {
    icon: '📅',
    title: 'Project Meetings',
    desc: 'Schedule meetings inside projects with agenda, minutes, attendee RSVPs, and linked tasks. Separate from general Calendar events.',
    tip: 'Link tasks to a meeting so attendees know exactly what work items are on the agenda.',
  },
  {
    icon: '🗂️',
    title: 'Portfolios',
    desc: 'Group related projects into portfolios. View cross-project KPIs, health dashboards, milestone timelines, and resource allocation heatmaps.',
    tip: 'Create a portfolio per client or per quarter to get a unified view of all active work.',
  },
]

const TIPS = [
  { icon: '🏷️', tip: 'Tag contacts by service line (e.g. "Solar", "HVAC") to filter and target specific groups in bulk.' },
  { icon: '🔄', tip: 'Use a workflow to auto-enroll new contacts in a nurture sequence — set it once and it runs itself.' },
  { icon: '🏆', tip: 'Set up a "Deal Won" workflow to auto-generate an invoice when a deal moves to Closed Won.' },
  { icon: '🤝', tip: 'Use the Share feature to give specific teammates edit or view access to a contact or deal — without opening up everything.' },
  { icon: '🔍', tip: 'Check the Audit Log regularly to see what your team changed and when — great for onboarding accountability.' },
  { icon: '⏱️', tip: 'Track billable time during discovery calls and generate invoices from those entries directly.' },
  { icon: '🌐', tip: 'Web forms + workflows = hands-free lead intake. New form submissions can trigger sequences automatically.' },
  { icon: '📊', tip: 'Review the Analytics page weekly to spot which pipeline stages are creating the most drop-off.' },
  { icon: '❓', tip: 'Use the ? help chips in page headers to jump directly into the matching Help FAQ topic.' },
  { icon: '📁', tip: 'Use project templates to spin up new engagements with pre-configured columns, types, and workflows in seconds.' },
  { icon: '🔗', tip: 'Link predecessor tasks with "precedes" relations so the Gantt view shows dependencies visually.' },
  { icon: '👥', tip: 'Check the Team Planner weekly to catch over-allocation before it burns out your team.' },
  { icon: '📸', tip: 'Save a baseline at the start of every project phase so you can measure drift later.' },
]

const FAQS = [
  {
    category: 'Getting Started',
    items: [
      { q: 'How do I add a new contact?', a: 'Go to Contacts in the sidebar and click "+ Add Contact". Fill in the name, email, phone, and company, then save. You can also import contacts via CSV.' },
      { q: 'How do I create a deal in the pipeline?', a: 'Go to Pipeline → "+ New Deal". Select or create a contact, choose a stage, set a value and close date, then save. Drag cards between columns to update stage.' },
      { q: 'How do I invite employees or guests?', a: 'Go to Settings → Accounts (admin only). Use the Employees section to create a team member account with a temporary password. Use Guest Accounts to send a client portal invite by email.' },
      { q: 'What roles are available?', a: 'Admin — full access including user and settings management. Manager — can manage contacts, deals, and view all team members\' data. Rep — standard CRM access for sales representatives. Viewer — read-only. Roles can be assigned via Users (admin only) and are also accessible under Settings → Accounts.' },
      { q: 'How do I connect Gmail?', a: 'Go to Settings → Integrations and click "Connect Gmail". You\'ll be redirected to Google to authorize. Once connected, emails to and from your contacts sync into their timelines automatically.' },
    ],
  },
  {
    category: 'Contacts & Deals',
    items: [
      { q: 'How do I tag a contact?', a: 'Open a contact record and find the Tags field. Type a tag and press Enter to apply it. Tags appear in the contact list and can be filtered and searched.' },
      { q: 'How do I share a contact with a teammate?', a: 'Open the contact and click the Share button. Search for a team member and choose their permission level — View or Edit.' },
      { q: 'How do I log an activity against a contact?', a: 'Open the contact record and scroll to the Activity section. Click "+ Log Activity", choose the type (call, meeting, note), add a description and date, then save.' },
      { q: 'How do I set a close date reminder on a deal?', a: 'When creating or editing a deal, set a Close Date. You\'ll see upcoming close dates in Reminders. You can also create a workflow to alert you a set number of days before it.' },
      { q: 'Can I see Gmail emails inside a contact record?', a: 'Yes. Once Gmail is connected, emails sent to or received from a contact\'s email address appear in the Email Timeline section of their record.' },
    ],
  },
  {
    category: 'Proposals & Invoices',
    items: [
      { q: 'How do I send a proposal?', a: 'Go to Proposals → "+ New Proposal". Select a contact, add line items with descriptions and amounts, preview it, and click Send. The client gets access via their portal.' },
      { q: 'Can clients e-sign proposals?', a: 'Yes. When you send a proposal, the client receives a link to their portal where they can review and e-sign. You\'ll get notified when they sign.' },
      { q: 'How do I convert a proposal to an invoice?', a: 'Open an accepted proposal and click "Create Invoice". The line items carry over automatically — no re-entry needed.' },
      { q: 'How do I accept online payments?', a: 'Connect Stripe in Settings → Integrations. Once connected, invoices will include a "Pay Now" link that clients can use to pay by card directly from their portal.' },
      { q: 'How do I mark an invoice as paid?', a: 'Open the invoice from the Invoices page and click "Mark as Paid". This records the payment date and updates the status to Paid.' },
    ],
  },
  {
    category: 'SMS & Email',
    items: [
      { q: 'How do I send an SMS to a contact?', a: 'Open a contact record and click "Send SMS". You can also go to the SMS section in the sidebar to see all active conversations, or trigger SMS automatically via a workflow.' },
      { q: 'How do I create an SMS template?', a: 'Go to Settings → SMS Templates. Create templates with variables like {{name}}, {{company}}, and {{date}} that auto-fill when you use the template in a message.' },
      { q: 'Why is SMS not sending?', a: 'Make sure your Twilio credentials (Account SID, Auth Token, Phone Number) are configured in your .env file. Also verify your Twilio webhook URL is set to https://yourdomain.com/api/webhooks/twilio in the Twilio console.' },
      { q: 'How does Gmail sync work?', a: 'After connecting Gmail, the CRM syncs your inbox periodically. Emails matching a contact\'s email address appear automatically in their Email Timeline. Sync runs in the background every few minutes.' },
      { q: 'Can I send emails directly from the CRM?', a: 'Currently the CRM displays synced Gmail emails in contact timelines and can send automated emails via sequences and workflows. Direct email composition within the CRM is on the roadmap.' },
    ],
  },
  {
    category: 'Workflows & Sequences',
    items: [
      { q: 'How do I create a workflow?', a: 'Go to Outbound → Execution. In the Workflow Rules section, click create rule, choose trigger event and conditions, then configure actions like reminders, suppressions, and sequence enrollment.' },
      { q: 'What triggers are available?', a: 'Triggers include: Contact Created, Deal Created, Deal Stage Changed, Form Submitted, and Reminder Due. Each trigger supports conditions so you can target specific cases (e.g. only when deal stage = "Proposal Sent").' },
      { q: 'What is an email sequence?', a: 'A sequence is a series of timed emails sent to a contact automatically. For example: email on day 1, follow-up on day 3, final check-in on day 7. Contacts move through the steps automatically after enrollment.' },
      { q: 'How do I enroll a contact in a sequence?', a: 'Go to Outbound → Leads, select one or more leads, choose a sequence in Advanced Bulk Actions, and enroll. You can also enroll from the row-level sequence controls.' },
      { q: 'Can I pause or stop a contact mid-sequence?', a: 'Yes. Go to Outbound → Execution, open Sequence Manager, and change each enrollment state to paused, resumed, or stopped.' },
    ],
  },
  {
    category: 'Projects & Tasks',
    items: [
      { q: 'How do I create a project?', a: 'Go to Projects → "+ New Project". Give it a name, description, and status. You can also create one from a template to copy columns, views, types, and workflows.' },
      { q: 'What views are available for projects?', a: 'Grid (spreadsheet with hierarchy), Kanban (drag-and-drop columns), Gantt (timeline with dependencies), Calendar (due dates), Sprints (Agile boards), Team Planner (resource allocation), Baselines (snapshots), Phases (life cycle timeline), and Meetings.' },
      { q: 'How do I create subtasks?', a: 'In Grid view, click the indent arrow (→) on a task row to make it a subtask of the task above. Click outdent (←) to promote it back. You can also use the "+ Add subtask" inline input under any parent task.' },
      { q: 'How does progress rollup work?', a: 'Parent tasks automatically calculate their progress from child tasks. If a parent has two children at 50% and 100%, the parent shows the average (75%).' },
      { q: 'What are task types?', a: 'Each project can define custom types (Task, Milestone, Bug, Epic, etc.) with colors and icons. Types can have workflow rules that restrict which status transitions are allowed.' },
      { q: 'How do I link tasks together?', a: 'Open a task and go to the Relations tab. Choose a relation type (precedes, follows, blocks, blocked_by, duplicates, relates_to, part_of) and select the other task. The system prevents circular dependencies.' },
      { q: 'How do I log time on a task?', a: 'Open a task and go to the Time tab. Enter hours, date, description, and check Billable if needed. Spent hours roll up to parent tasks automatically.' },
      { q: 'How do sprints work?', a: 'Go to the Sprints view, create a sprint with start/end dates and a goal. Drag backlog tasks into the sprint and assign story points. Use the burndown chart to track progress.' },
      { q: 'What is a baseline?', a: 'A baseline is a snapshot of your project at a point in time. Save one from the project header, then compare it later in the Baselines view to see what changed — added tasks, removed tasks, and field-level diffs.' },
      { q: 'How does the Team Planner work?', a: 'Schedule tasks by assigning users with start/end dates and an allocation percentage. The grid shows each member\'s daily load. Green under 80%, amber 80-100%, red over 100%.' },
      { q: 'How do project phases work?', a: 'Phases define sequential stages of a project (e.g. Discovery, Design, Build, Deploy). Each phase has deliverables and can require gate approval before completion. Tasks can be linked to phases.' },
      { q: 'How do I create a project template?', a: 'Open any project and click "Save as Template" in the header. When creating a new project, choose "Create from Template" to clone columns, views, types, workflows, and optionally task skeletons.' },
      { q: 'How do portfolios work?', a: 'Go to Portfolios in the sidebar. Create a portfolio and add related projects. The detail page shows cross-project KPIs, health status per project, milestone timelines, and resource allocation.' },
      { q: 'How do I schedule a project meeting?', a: 'Inside a project, go to the Meetings view. Click "Schedule Meeting", fill in title, time, location, agenda, and attendees. You can also link tasks to the meeting agenda.' },
    ],
  },
  {
    category: 'Calendar & Time Tracking',
    items: [
      { q: 'How do I add a calendar event?', a: 'Go to Calendar and click on a day or time slot. Fill in the event details — you can link it to a contact or deal for full context.' },
      { q: 'How do I sync with Google Calendar?', a: 'Go to Settings → Integrations and connect your Google Calendar account. Events sync so your CRM calendar and Google Calendar stay in sync.' },
      { q: 'How do I log time against a deal?', a: 'Go to Time Tracking → "+ Log Time". Select the deal or contact, enter the duration and description, and check Billable if it should appear on an invoice.' },
      { q: 'How do I add billable time to an invoice?', a: 'When creating an invoice, you can import billable time entries linked to that contact or deal as line items — no manual re-entry needed.' },
      { q: 'How do I log time on a project task?', a: 'Open the task detail panel and go to the Time tab. Add hours, description, and billable flag. The task\'s spent hours update automatically and roll up to parent tasks.' },
    ],
  },
  {
    category: 'Client Portal',
    items: [
      { q: 'How do clients access their portal?', a: 'Invite a client from Settings → Accounts. They receive an email with a link to set their password. After that they can log in at /client/login.' },
      { q: 'What can clients see in the portal?', a: 'Clients can view proposals shared with them, invoices, uploaded files, and their activity history. They cannot see any internal CRM data, other contacts, or team information.' },
      { q: 'Can clients pay invoices from the portal?', a: 'Yes, if Stripe is connected. Invoices in the client portal include a "Pay Now" button that handles card payment directly.' },
      { q: 'What if a client forgets their password?', a: 'The client can request a new magic link from the client login page. You can also re-invite them from Settings → Accounts, which sends a fresh invitation email.' },
    ],
  },
  {
    category: 'Admin & Troubleshooting',
    items: [
      { q: 'How do I view the audit log?', a: 'Go to Audit Logs in the sidebar (visible to admin and manager roles). You\'ll see a full history of who changed what and when across the CRM.' },
      { q: 'How do I create a team?', a: 'Go to Teams in the sidebar. Click "+ New Team", add a name and description, then add members and assign a team lead.' },
      { q: 'Why is my workflow not firing?', a: 'Check that the workflow status is Active. Verify the trigger conditions match your test scenario exactly. Also confirm that Redis is running — workflows rely on background job queues.' },
      { q: 'Why isn\'t Gmail syncing?', a: 'Go to Settings → Integrations and check if Gmail shows as connected. If the token expired (Google tokens expire after ~1 hour of inactivity), disconnect and reconnect. Also ensure your Google OAuth app has the correct redirect URI configured in the Google Cloud console.' },
      { q: 'A client says they can\'t access their portal. What do I check?', a: 'First check that they\'re using the correct URL (/client/login). Re-invite them from Settings → Accounts to send a fresh email link. If they set a password and forgot it, the client login page has a magic link option.' },
    ],
  },
]

const SUPPORT_LINKS = [
  { label: 'Email Support', href: 'mailto:support@resiq.co', icon: '✉️', desc: 'Response within 1 business day' },
  { label: 'Documentation', href: 'https://github.com/siddonj/resiq-crm/blob/main/README.md', icon: '📚', desc: 'Technical setup & configuration' },
  { label: 'Report a Bug', href: 'https://github.com/siddonj/resiq-crm/issues/new', icon: '🐛', desc: 'Found something broken?' },
]

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'faq', label: 'FAQ' },
  { id: 'contact', label: 'Contact' },
]

export default function Help() {
  const [searchParams] = useSearchParams()
  const initialTab = useMemo(() => {
    const requestedTab = searchParams.get('tab')
    if (requestedTab && TABS.some((tab) => tab.id === requestedTab)) {
      return requestedTab
    }
    return searchParams.get('q') ? 'faq' : 'overview'
  }, [searchParams])
  const initialSearch = useMemo(() => searchParams.get('q') || '', [searchParams])

  const [activeTab, setActiveTab] = useState(initialTab)
  const [openFaq, setOpenFaq] = useState(null)
  const [search, setSearch] = useState(initialSearch)
  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' })
  const [submitted, setSubmitted] = useState(false)

  const toggleFaq = (key) => setOpenFaq(openFaq === key ? null : key)

  const filteredFaqs = FAQS.map(cat => ({
    ...cat,
    items: cat.items.filter(item =>
      !search ||
      item.q.toLowerCase().includes(search.toLowerCase()) ||
      item.a.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(cat => cat.items.length > 0)

  const handleContact = (e) => {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <div className="p-8 max-w-5xl">
      <h2 className="font-syne text-2xl font-bold text-navy mb-1">Help & Support</h2>
      <p className="text-sm text-gray-500 mb-6">Guides, tips, and answers to get the most out of ResiQ CRM.</p>
      <p className="text-xs text-teal mb-6">Tip: click the ? help chips in page headers to open this page with the most relevant FAQ topic pre-filtered.</p>

      <div className="flex gap-1 mb-8 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-teal text-teal'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-12">

          <div>
            <h3 className="font-syne text-lg font-semibold text-navy mb-1">Quick Start</h3>
            <p className="text-sm text-gray-500 mb-5">New to ResiQ? Get up and running in 5 steps.</p>
            <div className="space-y-3">
              {QUICK_START.map(step => (
                <div key={step.step} className="flex gap-4 bg-white rounded-xl shadow-sm p-4">
                  <div className="w-8 h-8 rounded-full bg-teal/10 text-teal font-bold text-sm flex items-center justify-center shrink-0">
                    {step.step}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-navy mb-0.5">{step.icon} {step.title}</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-syne text-lg font-semibold text-navy mb-1">Feature Guide</h3>
            <p className="text-sm text-gray-500 mb-5">What each section does — and how to get the most from it.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map(f => (
                <div key={f.title} className="bg-white rounded-xl shadow-sm p-5 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{f.icon}</span>
                    <span className="font-semibold text-gray-800 text-sm">{f.title}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed mb-3 flex-1">{f.desc}</p>
                  <div className="bg-teal/5 border border-teal/20 rounded-lg px-3 py-2">
                    <p className="text-xs text-teal leading-relaxed"><span className="font-semibold">Tip:</span> {f.tip}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-syne text-lg font-semibold text-navy mb-1">Pro Tips</h3>
            <p className="text-sm text-gray-500 mb-5">Suggested workflows to save time and close more deals.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TIPS.map((t, i) => (
                <div key={i} className="flex gap-3 bg-white rounded-xl shadow-sm p-4">
                  <span className="text-xl shrink-0">{t.icon}</span>
                  <p className="text-sm text-gray-600 leading-relaxed">{t.tip}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* FAQ */}
      {activeTab === 'faq' && (
        <div className="space-y-6">
          <input
            type="text"
            placeholder="Search questions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
          />
          {filteredFaqs.length === 0 ? (
            <p className="text-sm text-gray-400">No results for "{search}".</p>
          ) : filteredFaqs.map(cat => (
            <div key={cat.category}>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{cat.category}</h3>
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                {cat.items.map((item, i) => {
                  const key = `${cat.category}-${i}`
                  return (
                    <div key={key}>
                      <button
                        onClick={() => toggleFaq(key)}
                        className="w-full text-left px-5 py-4 flex justify-between items-center hover:bg-gray-50 transition-colors"
                      >
                        <span className="font-medium text-gray-800 text-sm">{item.q}</span>
                        <span className="text-gray-400 ml-4 shrink-0 text-xs">{openFaq === key ? '▲' : '▼'}</span>
                      </button>
                      {openFaq === key && (
                        <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">{item.a}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Contact */}
      {activeTab === 'contact' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {SUPPORT_LINKS.map(link => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:border-teal/40 hover:bg-teal/5 transition-colors"
              >
                <span className="text-2xl">{link.icon}</span>
                <div>
                  <p className="font-medium text-gray-700 text-sm">{link.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{link.desc}</p>
                </div>
              </a>
            ))}
          </div>

          {submitted ? (
            <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-5 text-sm">
              Message sent — we'll get back to you within 1 business day.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-syne text-base font-semibold text-navy mb-4">Send us a message</h3>
              <form onSubmit={handleContact} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                    <input
                      required
                      type="text"
                      value={contactForm.name}
                      onChange={e => setContactForm({ ...contactForm, name: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                    <input
                      required
                      type="email"
                      value={contactForm.email}
                      onChange={e => setContactForm({ ...contactForm, email: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                  <textarea
                    required
                    rows={4}
                    value={contactForm.message}
                    onChange={e => setContactForm({ ...contactForm, message: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                  />
                </div>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 transition-colors"
                >
                  Send Message
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
