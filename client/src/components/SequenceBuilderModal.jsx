import { useState, useEffect } from 'react'
import { PlusIcon, XMarkIcon, TrashIcon } from '@heroicons/react/24/outline'
import AskAIBtn from './AskAIBtn'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export default function SequenceBuilderModal({ isOpen, onClose, sequence, onSaved }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (sequence) {
      setName(sequence.name || '')
      setDescription(sequence.description || '')
      fetchSteps(sequence.id)
    } else {
      setName('')
      setDescription('')
      setSteps([])
    }
  }, [sequence])

  const fetchSteps = async (id) => {
    try {
      const res = await fetch(`${API_URL}/api/sequences/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('resiq_token')}` }
      })
      if (res.ok) {
        const data = await res.json()
        setSteps(data.steps || [])
      }
    } catch (err) {
      console.error('Error fetching steps:', err)
    }
  }

  const handleAddStep = (type) => {
    setSteps([...steps, { type, delay_days: 1, subject: '', body: '' }])
  }

  const handleRemoveStep = (index) => {
    setSteps(steps.filter((_, i) => i !== index))
  }

  const updateStep = (index, field, value) => {
    const updated = [...steps]
    updated[index][field] = value
    setSteps(updated)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Sequence name is required')
      return
    }

    if (steps.some(s => s.type === 'email' && !s.subject.trim())) {
      setError('All email steps must have a subject')
      return
    }

    if (steps.some(s => !s.body.trim())) {
      setError('All steps must have message content')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      let seqId = sequence?.id

      // 1. Create or update sequence metadata
      if (!seqId) {
        const res = await fetch(`${API_URL}/api/sequences`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('resiq_token')}` 
          },
          body: JSON.stringify({ name, description })
        })
        
        if (!res.ok) throw new Error('Failed to create sequence: ' + await res.text())
        const data = await res.json()
        seqId = data.id
      } 
      // Update logic could be implemented here as well

      // 2. Overwrite steps
      const stepsRes = await fetch(`${API_URL}/api/sequences/${seqId}/steps`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('resiq_token')}` 
        },
        body: JSON.stringify({ steps })
      })

      if (!stepsRes.ok) throw new Error('Failed to save steps: ' + await stepsRes.text())

      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={onClose}></div>
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
        
        <div className="inline-block align-bottom bg-gray-50 rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full sm:p-6 border border-gray-200">
          <div className="flex justify-between items-center pb-4 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
              {sequence ? 'Edit Sequence' : 'Create Sequence'}
            </h3>
            <button onClick={onClose} className="rounded-md text-gray-400 hover:text-gray-500">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {error && (
            <div className="mt-4 bg-red-50 border-l-4 border-red-400 p-4">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 pb-4 border-b border-gray-200 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sequence Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                placeholder="e.g. Lead Follow-Up Sequence"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                placeholder="Internal notes about who this is for..."
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center">
            {steps.length === 0 ? (
              <div className="text-center bg-white p-8 rounded-lg shadow-sm border border-gray-200 w-full mb-6">
                <p className="text-gray-500 mb-4">No steps added yet.</p>
                <div className="flex gap-4 justify-center">
                  <button onClick={() => handleAddStep('email')} className="inline-flex items-center px-3 py-2 border border-blue-200 shadow-sm text-sm font-medium rounded text-blue-700 bg-blue-50 hover:bg-blue-100">
                    + Add Email Step
                  </button>
                  <button onClick={() => handleAddStep('sms')} className="inline-flex items-center px-3 py-2 border border-green-200 shadow-sm text-sm font-medium rounded text-green-700 bg-green-50 hover:bg-green-100">
                    + Add SMS Step
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full space-y-6">
                {steps.map((step, idx) => (
                  <div key={idx} className="relative border border-gray-200 bg-white rounded-lg shadow-sm p-4">
                    {idx > 0 && (
                      <div className="absolute -top-6 left-1/2 -ml-px w-0.5 h-6 bg-gray-300"></div>
                    )}
                    
                    <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                      <div className="flex items-center justify-between gap-4 w-full mr-4">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${step.type === 'email' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                            Step {idx + 1}: {step.type.toUpperCase()}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          Wait
                          <input
                            type="number"
                            min="0"
                            className="shadow-sm border border-gray-300 rounded px-2 w-16 py-1 text-center"
                            value={step.delay_days}
                            onChange={(e) => updateStep(idx, 'delay_days', parseInt(e.target.value) || 0)}
                          />
                          days {idx === 0 ? "after start" : "after previous step"}
                        </div>
                      </div>
                      
                      <button onClick={() => handleRemoveStep(idx)} className="text-red-400 hover:text-red-500">
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      {step.type === 'email' && (
                         <div>
                          <label className="block text-xs font-medium text-gray-500 uppercase">Subject Line <span className="font-normal lowercase text-gray-400">(Supports {'{{first_name}}'})</span></label>
                          <input
                            type="text"
                            value={step.subject}
                            onChange={(e) => updateStep(idx, 'subject', e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded px-3 py-2 text-sm"
                            placeholder="Checking in..."
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase">Message Body <span className="font-normal lowercase text-gray-400">(Supports {'{{first_name}}'})</span></label>
                        <textarea
                          rows={step.type === 'email' ? 4 : 2}
                          value={step.body}
                          onChange={(e) => updateStep(idx, 'body', e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded px-3 py-2 text-sm"
                          placeholder={`Hi {{first_name}}, just wanted to send you...`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                
                <div className="flex flex-col items-center pt-2">
                  <div className="w-0.5 h-6 bg-gray-300 mb-2"></div>
                  <div className="flex gap-4">
                    <button onClick={() => handleAddStep('email')} className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded text-gray-700 bg-white hover:bg-gray-50">
                      + Add Email
                    </button>
                    <button onClick={() => handleAddStep('sms')} className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded text-gray-700 bg-white hover:bg-gray-50">
                      + Add SMS
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 pb-4">
            <AskAIBtn 
              toolName="Sequences" 
              label="✨ Ask AI for drip campaign ideas or messaging templates"
              contextData={{ name, description, steps }}
            />
          </div>

          <div className="mt-5 sm:mt-6 sm:flex sm:flex-row-reverse border-t border-gray-200 pt-4">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Sequence'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:w-auto sm:text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
