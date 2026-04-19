import { useState } from 'react'

const faqs = [
  {
    category: 'Getting Started',
    items: [
      {
        q: 'How do I add a new contact?',
        a: 'Go to Contacts in the sidebar, then click the "+ Add Contact" button. Fill in the contact details and click Save.'
      },
      {
        q: 'How do I create a deal in the pipeline?',
        a: 'Navigate to Pipeline, click "+ New Deal", select a contact, set the stage and value, then save. Drag cards between columns to update deal stages.'
      },
      {
        q: 'How do I invite team members?',
        a: 'Go to Users (admin only) and click "Invite User". Enter their email and assign a role: Admin, Manager, or Agent.'
      },
    ]
  },
  {
    category: 'Proposals & Invoices',
    items: [
      {
        q: 'How do I send a proposal to a client?',
        a: 'Go to Proposals, click "+ New Proposal", select a client, add line items, then click "Send". The client will receive access via the Client Portal.'
      },
      {
        q: 'How do I mark an invoice as paid?',
        a: 'Open the invoice from the Invoices page and click "Mark as Paid". This updates the status and notifies the client.'
      },
      {
        q: 'Can clients sign proposals electronically?',
        a: 'Yes. When you send a proposal, the client receives a link to view and e-sign it through their Client Portal.'
      },
    ]
  },
  {
    category: 'SMS & Communication',
    items: [
      {
        q: 'How do I send an SMS to a contact?',
        a: 'Open a contact record and click "Send SMS". You can also set up automated SMS workflows in the Workflows section.'
      },
      {
        q: 'How do I set up SMS templates?',
        a: 'Go to Settings → SMS Templates. Create templates with variables like {{name}}, {{date}} that auto-fill when sending.'
      },
      {
        q: 'Why is SMS not sending?',
        a: 'Ensure your Twilio credentials are configured in Settings and the webhook URL is set in your Twilio console to https://crm.resiq.co/api/webhooks/twilio.'
      },
    ]
  },
  {
    category: 'Workflows & Automation',
    items: [
      {
        q: 'How do I create an automated workflow?',
        a: 'Go to Workflows, click "+ New Workflow", set a trigger (e.g. new contact, deal stage change), then add actions like send SMS, create reminder, or send email.'
      },
      {
        q: 'Can I schedule follow-up reminders?',
        a: 'Yes. Go to Reminders and click "+ New Reminder", or add a reminder action inside a workflow to automate follow-ups.'
      },
    ]
  },
  {
    category: 'Client Portal',
    items: [
      {
        q: 'How do clients access their portal?',
        a: 'Clients receive a login link via email when you send them a proposal or invoice. They can also access it at https://crm.resiq.co/client.'
      },
      {
        q: 'What can clients see in the portal?',
        a: 'Clients can view their proposals, invoices, uploaded files, and activity history. They cannot see internal CRM data.'
      },
    ]
  },
]

const supportLinks = [
  { label: 'Email Support', href: 'mailto:support@resiq.co', icon: '✉️' },
  { label: 'Documentation', href: 'https://github.com/siddonj/resiq-crm/blob/main/README.md', icon: '📚' },
  { label: 'Report a Bug', href: 'https://github.com/siddonj/resiq-crm/issues/new', icon: '🐛' },
]

export default function Help() {
  const [openItem, setOpenItem] = useState(null)
  const [search, setSearch] = useState('')
  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' })
  const [submitted, setSubmitted] = useState(false)

  const toggle = (key) => setOpenItem(openItem === key ? null : key)

  const filtered = faqs.map(cat => ({
    ...cat,
    items: cat.items.filter(
      item =>
        !search ||
        item.q.toLowerCase().includes(search.toLowerCase()) ||
        item.a.toLowerCase().includes(search.toLowerCase())
    )
  })).filter(cat => cat.items.length > 0)

  const handleContact = (e) => {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Help & Support</h1>
        <p className="text-gray-500 mt-1">Find answers, guides, and ways to contact us.</p>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search help articles..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {/* FAQ */}
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Frequently Asked Questions</h2>
        {filtered.length === 0 && (
          <p className="text-gray-500 text-sm">No results found for "{search}".</p>
        )}
        <div className="space-y-6">
          {filtered.map(cat => (
            <div key={cat.category}>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">{cat.category}</h3>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
                {cat.items.map((item, i) => {
                  const key = `${cat.category}-${i}`
                  return (
                    <div key={key}>
                      <button
                        onClick={() => toggle(key)}
                        className="w-full text-left px-5 py-4 flex justify-between items-center hover:bg-gray-50 transition-colors"
                      >
                        <span className="font-medium text-gray-800 text-sm">{item.q}</span>
                        <span className="text-gray-400 ml-4">{openItem === key ? '▲' : '▼'}</span>
                      </button>
                      {openItem === key && (
                        <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
                          {item.a}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Resources</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {supportLinks.map(link => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-teal-400 hover:bg-teal-50 transition-colors"
            >
              <span className="text-2xl">{link.icon}</span>
              <span className="font-medium text-gray-700 text-sm">{link.label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Contact Form */}
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Contact Support</h2>
        {submitted ? (
          <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-5 text-sm">
            ✅ Message sent! We'll get back to you within 1 business day.
          </div>
        ) : (
          <form onSubmit={handleContact} className="space-y-4 bg-white border border-gray-200 rounded-lg p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  required
                  type="text"
                  value={contactForm.name}
                  onChange={e => setContactForm({ ...contactForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  required
                  type="email"
                  value={contactForm.email}
                  onChange={e => setContactForm({ ...contactForm, email: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea
                required
                rows={4}
                value={contactForm.message}
                onChange={e => setContactForm({ ...contactForm, message: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <button
              type="submit"
              className="bg-teal-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
            >
              Send Message
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
