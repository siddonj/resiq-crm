import React, { useState } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function AskAIBtn({ toolName, contextData, label = '✨ Ask AI', buttonClass, goalPrompt = '' }) {
  const { token } = useAuth()
  const [loading, setLoading] = useState(false)
  const [advice, setAdvice] = useState(null)
  const [open, setOpen] = useState(false)

  const askCopilot = async () => {
    if (!open) setOpen(true)
    if (advice) return

    setLoading(true)
    try {
      const res = await axios.post('/api/agents/advice', 
        { tool: toolName, contextData, goal: goalPrompt },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setAdvice(res.data.advice)
    } catch (err) {
      console.error(err)
      setAdvice('Sorry, the AI is taking a coffee break. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  // Common wrapper around the inline button & expandable advice
  return (
    <div className="my-3">
      {!open && (
        <button 
          type="button"
          onClick={askCopilot}
          className={buttonClass || "flex items-center text-teal-600 hover:text-teal-800 font-medium text-sm transition"}
        >
          {label}
        </button>
      )}

      {open && (
        <div className="bg-teal-50/50 p-4 rounded-lg border border-teal-100 text-sm relative mt-2">
          <button 
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
            title="Close AI advice"
          >
            ✕
          </button>
          
          <h5 className="font-bold text-teal-800 mb-3 flex items-center gap-2">
            ✨ AI Assistant
          </h5>

          {loading ? (
            <p className="text-gray-500 flex items-center gap-2 animate-pulse">Thinking of a smart strategy...</p>
          ) : (
            <div className="prose prose-sm prose-teal max-w-none text-gray-700 whitespace-pre-wrap">
              {advice}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
