import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const PROVIDERS = [
  {
    key: 'twilio',
    label: 'Twilio (SMS)',
    fields: [
      { key: 'twilio_account_sid', label: 'Account SID' },
      { key: 'twilio_auth_token', label: 'Auth Token' },
      { key: 'twilio_phone_number', label: 'Phone Number' },
    ],
  },
  {
    key: 'stripe',
    label: 'Stripe (Payments)',
    fields: [
      { key: 'stripe_secret_key', label: 'Secret Key' },
      { key: 'stripe_webhook_secret', label: 'Webhook Secret' },
    ],
  },
  {
    key: 'smtp',
    label: 'SMTP (Email)',
    fields: [
      { key: 'smtp_host', label: 'Host' },
      { key: 'smtp_port', label: 'Port' },
      { key: 'smtp_user', label: 'Username' },
      { key: 'smtp_pass', label: 'Password' },
      { key: 'smtp_from', label: 'From Address' },
      { key: 'smtp_secure', label: 'Use TLS', type: 'boolean' },
    ],
  },
  {
    key: 'hunter',
    label: 'Hunter.io (Enrichment)',
    fields: [{ key: 'hunter_api_key', label: 'API Key' }],
  },
  {
    key: 'openai',
    label: 'OpenAI (AI Features)',
    fields: [{ key: 'openai_api_key', label: 'API Key' }],
  },
  {
    key: 'sendgrid',
    label: 'SendGrid (Outbound Email)',
    fields: [
      { key: 'sendgrid_api_key', label: 'API Key' },
      { key: 'sendgrid_webhook_verification_key', label: 'Event Webhook Verification Key' },
      { key: 'outbound_from_default', label: 'Default From Address' },
    ],
  },
]

export default function IntegrationCredentials() {
  const { token } = useAuth()
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  const [settingsByKey, setSettingsByKey] = useState({})
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingProvider, setSavingProvider] = useState(null)
  const [testingProvider, setTestingProvider] = useState(null)
  const [messages, setMessages] = useState({})

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/integration-settings', authHeaders)
      const map = {}
      ;(res.data?.settings || []).forEach((item) => { map[item.key] = item })
      setSettingsByKey(map)
    } catch (err) {
      console.error('Failed to load integration settings', err)
    } finally {
      setLoading(false)
    }
  }

  const textFieldValue = (field) => {
    if (drafts[field.key] !== undefined) return drafts[field.key]
    const item = settingsByKey[field.key]
    if (!item || item.secret) return ''
    return item.value ?? ''
  }

  const booleanFieldValue = (field) => {
    if (drafts[field.key] !== undefined) return !!drafts[field.key]
    return !!settingsByKey[field.key]?.value
  }

  const fieldPlaceholder = (field) => {
    const item = settingsByKey[field.key]
    if (item?.secret) return item.configured ? item.maskedValue : 'Not set'
    return ''
  }

  const handleFieldChange = (fieldKey, value) => {
    setDrafts((prev) => ({ ...prev, [fieldKey]: value }))
  }

  const draftPayload = (provider) => {
    const payload = {}
    provider.fields.forEach((field) => {
      if (drafts[field.key] !== undefined && drafts[field.key] !== '') {
        payload[field.key] = drafts[field.key]
      }
    })
    return payload
  }

  const handleSave = async (provider) => {
    setMessages((prev) => ({ ...prev, [provider.key]: null }))
    setSavingProvider(provider.key)
    try {
      await axios.put('/api/integration-settings', { settings: draftPayload(provider) }, authHeaders)
      setMessages((prev) => ({ ...prev, [provider.key]: { type: 'success', text: 'Saved.' } }))
      setDrafts((prev) => {
        const next = { ...prev }
        provider.fields.forEach((field) => delete next[field.key])
        return next
      })
      await loadSettings()
    } catch (err) {
      setMessages((prev) => ({
        ...prev,
        [provider.key]: { type: 'error', text: err.response?.data?.error || 'Failed to save.' },
      }))
    } finally {
      setSavingProvider(null)
    }
  }

  const handleTest = async (provider) => {
    setMessages((prev) => ({ ...prev, [provider.key]: null }))
    setTestingProvider(provider.key)
    try {
      const res = await axios.post(
        `/api/integration-settings/${provider.key}/test`,
        { overrides: draftPayload(provider) },
        authHeaders
      )
      setMessages((prev) => ({
        ...prev,
        [provider.key]: res.data.success
          ? { type: 'success', text: 'Connection successful.' }
          : { type: 'error', text: res.data.error || 'Connection failed.' },
      }))
    } catch (err) {
      setMessages((prev) => ({
        ...prev,
        [provider.key]: { type: 'error', text: err.response?.data?.error || 'Connection test failed.' },
      }))
    } finally {
      setTestingProvider(null)
    }
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal'
  const btnCls = 'px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors'
  const secondaryBtnCls = 'px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors'

  const isConfigured = (provider) => provider.fields.every((field) => settingsByKey[field.key]?.configured)

  if (loading) return <p className="text-sm text-gray-500">Loading integration settings...</p>

  return (
    <div className="space-y-6">
      {PROVIDERS.map((provider) => (
        <div key={provider.key} className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-navy">{provider.label}</h3>
            <span
              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                isConfigured(provider) ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {isConfigured(provider) ? 'Configured' : 'Not configured'}
            </span>
          </div>

          {messages[provider.key] && (
            <p className={`text-sm mb-3 ${messages[provider.key].type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {messages[provider.key].text}
            </p>
          )}

          <div className="space-y-3">
            {provider.fields.map((field) =>
              field.type === 'boolean' ? (
                <label key={field.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={booleanFieldValue(field)}
                    onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  {field.label}
                </label>
              ) : (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
                  <input
                    type={settingsByKey[field.key]?.secret ? 'password' : 'text'}
                    value={textFieldValue(field)}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    placeholder={fieldPlaceholder(field)}
                    className={inputCls}
                  />
                </div>
              )
            )}
          </div>

          <div className="flex gap-3 mt-4">
            <button onClick={() => handleSave(provider)} disabled={savingProvider === provider.key} className={btnCls}>
              {savingProvider === provider.key ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => handleTest(provider)} disabled={testingProvider === provider.key} className={secondaryBtnCls}>
              {testingProvider === provider.key ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
