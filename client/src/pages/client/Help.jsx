import { useState } from 'react'

const faqs = [
  {
    q: 'How do I view my proposals?',
    a: 'Click "Proposals" in the sidebar to see all proposals sent to you. You can review and e-sign them directly from your portal.'
  },
  {
    q: 'How do I pay an invoice?',
    a: 'Go to Invoices, open the invoice, and click "Pay Now". You will be redirected to a secure payment page.'
  },
  {
    q: 'How do I download my files?',
    a: 'Click "Files" in the sidebar. All documents shared with you are listed there and can be downloaded anytime.'
  },
  {
    q: 'How do I sign a proposal?',
    a: 'Open the proposal and scroll to the bottom. Click "Sign Proposal" and enter your name to apply your e-signature.'
  },
  {
    q: 'How do I contact my agent?',
    a: 'Use the Contact Support form below or reply to any email you received from your agent.'
  },
  {
    q: 'What is shown in Activity?',
    a: 'The Activity tab shows a timeline of all interactions — emails, calls, document views, and invoice payments related to your project.'
  },
]

export default function ClientHelp() {
  const [openItem, setOpenItem] = useState(null)
  const [contactForm, setContactForm] = useState({ subject: '', message: '' })
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Help & Support</h1>
        <p className="text-gray-500 mt-1 text-sm">How can we help you today?</p>
      </div>

      {/* FAQ */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Frequently Asked Questions</h2>
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
          {faqs.map((item, i) => (
            <div key={i}>
              <button
                onClick={() => setOpenItem(openItem === i ? null : i)}
                className="w-full text-left px-5 py-4 flex justify-between items-center hover:bg-gray-50 transition-colors"
              >
                <span className="font-medium text-gray-800 text-sm">{item.q}</span>
                <span className="text-gray-400 ml-4">{openItem === i ? '▲' : '▼'}</span>
              </button>
              {openItem === i && (
                <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Contact Form */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Contact Your Agent</h2>
        {submitted ? (
          <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-5 text-sm">
            ✅ Message sent! Your agent will respond shortly.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-gray-200 rounded-lg p-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input
                required
                type="text"
                placeholder="e.g. Question about my invoice"
                value={contactForm.subject}
                onChange={e => setContactForm({ ...contactForm, subject: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea
                required
                rows={4}
                value={contactForm.message}
                onChange={e => setContactForm({ ...contactForm, message: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Send Message
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
