import React, { useState } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

const formatServiceLine = (value) => {
  if (!value) return 'Custom'
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

const withLocalIds = (prospects = []) => prospects.map((prospect, index) => ({
  ...prospect,
  localId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}-${prospect.email || prospect.company || prospect.name || 'prospect'}`,
}))

const toImportPayload = ({ name, email, phone, company, service_line, notes }) => ({
  name,
  email,
  phone,
  company,
  service_line,
  notes,
})

export default function Agents() {
  const { token } = useAuth()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [prospects, setProspects] = useState([])
  const [selectedProspectIds, setSelectedProspectIds] = useState([])
  const [importing, setImporting] = useState(false)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }
  const selectedCount = selectedProspectIds.length
  const allSelected = prospects.length > 0 && selectedCount === prospects.length

  const toggleProspect = (prospectId) => {
    setSelectedProspectIds(prev => prev.includes(prospectId)
      ? prev.filter(id => id !== prospectId)
      : [...prev, prospectId])
  }

  const toggleAllProspects = () => {
    setSelectedProspectIds(allSelected ? [] : prospects.map(prospect => prospect.localId))
  }

  const handleProspect = async (e) => {
    e.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) return
    setLoading(true)
    setStatus('Agent is finding matching contacts...')
    setProspects([])
    setSelectedProspectIds([])
    try {
      const { data } = await axios.post('/api/agents/prospect', { prompt: trimmedPrompt }, authHeaders)
      const generatedProspects = withLocalIds(data.prospects || [])
      setProspects(generatedProspects)
      setSelectedProspectIds(generatedProspects.map(prospect => prospect.localId))
      setStatus(
        generatedProspects.length > 0
          ? `Review ${generatedProspects.length} suggested contacts and choose which ones to add.`
          : 'No matching contacts were found for that prompt.'
      )
    } catch (err) {
      console.error(err)
      setStatus(err.response?.data?.error || 'There was an error finding contacts.')
    } finally {
      setLoading(false)
    }
  }

  const handleImportSelected = async () => {
    const trimmedPrompt = prompt.trim()
    const selectedSet = new Set(selectedProspectIds)
    const selectedProspects = prospects
      .filter(prospect => selectedSet.has(prospect.localId))
      .map(toImportPayload)

    if (selectedProspects.length === 0) {
      setStatus('Select at least one contact to add.')
      return
    }

    setImporting(true)
    try {
      const { data } = await axios.post('/api/agents/prospect/import', {
        prompt: trimmedPrompt,
        prospects: selectedProspects,
      }, authHeaders)
      const remainingProspects = prospects.filter(prospect => !selectedSet.has(prospect.localId))
      setProspects(remainingProspects)
      setSelectedProspectIds([])
      setStatus(
        remainingProspects.length > 0
          ? `Added ${data.importedCount} contact${data.importedCount === 1 ? '' : 's'}. Review the remaining suggestions below.`
          : `Added ${data.importedCount} contact${data.importedCount === 1 ? '' : 's'} to Contacts.`
      )
    } catch (err) {
      console.error(err)
      setStatus(err.response?.data?.error || 'There was an error adding the selected contacts.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4 font-syne text-navy">AI Prospecting Agent</h2>
      <p className="text-gray-600 mb-6">
        Describe your ideal prospect. The agent will discover relevant companies, show suggested contacts here, and let you choose which ones to add.
      </p>

      <form onSubmit={handleProspect} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <label className="block text-sm font-medium text-gray-700 mb-2">Prompt</label>
        <textarea
          className="w-full border border-gray-300 rounded-md p-3 mb-4 min-h-[100px] font-dmsans focus:ring-teal focus:border-teal"
          placeholder="e.g. Find 3 property management companies in Austin, TX..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        
        <button
          type="submit"
          className="bg-teal hover:bg-teal/90 text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-400"
          disabled={loading || !prompt}
        >
          {loading ? 'Finding Contacts...' : 'Start Prospecting'}
        </button>

        {status && (
          <div className="mt-4 p-4 bg-teal/10 text-teal-800 rounded-md text-sm border border-teal/20">
            {status}
          </div>
        )}
      </form>

      {prospects.length > 0 && (
        <div className="mt-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-navy font-syne">Suggested Contacts</h3>
              <p className="text-sm text-gray-600">Choose which contacts should be added to your CRM.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-teal focus:ring-teal"
                checked={allSelected}
                onChange={toggleAllProspects}
              />
              Select all
            </label>
          </div>

          <div className="space-y-3">
            {prospects.map(prospect => (
              <label
                key={prospect.localId}
                className="flex gap-3 rounded-lg border border-gray-200 p-4 hover:border-teal/40 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="mt-1 rounded border-gray-300 text-teal focus:ring-teal"
                  checked={selectedProspectIds.includes(prospect.localId)}
                  onChange={() => toggleProspect(prospect.localId)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-navy">{prospect.name || 'Unknown Contact'}</p>
                      <p className="text-sm text-gray-600">{prospect.company || 'Unknown Company'}</p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-teal/10 px-2.5 py-1 text-xs font-medium text-teal w-fit">
                      {formatServiceLine(prospect.service_line)}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
                    <p><span className="font-medium text-gray-700">Email:</span> {prospect.email || 'Not provided'}</p>
                    <p><span className="font-medium text-gray-700">Phone:</span> {prospect.phone || 'Not provided'}</p>
                  </div>
                  {prospect.notes && (
                    <p className="mt-3 text-sm text-gray-600">{prospect.notes}</p>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-gray-100 pt-4">
            <p className="text-sm text-gray-600">
              {selectedCount} of {prospects.length} selected
            </p>
            <button
              type="button"
              onClick={handleImportSelected}
              disabled={importing || selectedCount === 0}
              className="bg-teal hover:bg-teal/90 text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-400"
            >
              {importing ? 'Adding Contacts...' : 'Add Selected to Contacts'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
