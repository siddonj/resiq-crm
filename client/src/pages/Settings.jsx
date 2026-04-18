import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import GmailConnect from '../components/GmailConnect'

export default function Settings() {
  const [searchParams] = useSearchParams()

  // Show success/error messages from OAuth callback
  const success = searchParams.get('success')
  const error = searchParams.get('error')

  useEffect(() => {
    // Clear URL params after displaying message
    if (success || error) {
      setTimeout(() => {
        window.history.replaceState({}, document.title, '/settings')
      }, 3000)
    }
  }, [success, error])

  return (
    <div className="p-8">
      <h2 className="font-syne text-2xl font-bold text-navy mb-6">Settings</h2>

      {success && (
        <div className="mb-6 px-4 py-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          ✅ {decodeURIComponent(success)}
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          ⚠️ {decodeURIComponent(error)}
        </div>
      )}

      <div className="space-y-6 max-w-2xl">
        <div>
          <h3 className="font-syne text-lg font-semibold text-navy mb-4">Integrations</h3>
          <GmailConnect />
        </div>

        <div className="border-t border-gray-100 pt-6">
          <h3 className="font-syne text-lg font-semibold text-navy mb-4">About</h3>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <p className="text-sm text-brand-gray mb-2">
              <strong>ResiQ CRM</strong> v0.1.0
            </p>
            <p className="text-xs text-gray-500">
              A lightweight CRM for property tech professionals. All data is stored securely and encrypted.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
