import React, { useState } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function Agents() {
  const { token } = useAuth()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const handleProspect = async (e) => {
    e.preventDefault()
    if (!prompt) return
    setLoading(true)
    setStatus('Agent is working on this in the background...')
    try {
      await axios.post('/api/agents/prospect', { prompt }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setPrompt('')
      setTimeout(() => setStatus('Leads are being generated and added to your Contacts!'), 2000)
    } catch (err) {
      console.error(err)
      setStatus('There was an error starting the agent job.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4 font-syne text-navy">AI Prospecting Agent</h2>
      <p className="text-gray-600 mb-6">
        Describe your ideal prospect. The agent will discover relevant companies and add them directly to your CRM.
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
          {loading ? 'Starting Agent...' : 'Start Prospecting'}
        </button>

        {status && (
          <div className="mt-4 p-4 bg-teal/10 text-teal-800 rounded-md text-sm border border-teal/20">
            {status}
          </div>
        )}
      </form>
    </div>
  )
}
