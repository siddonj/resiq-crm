import { useState, useEffect } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export default function EnrollSequenceModal({ isOpen, onClose, contact, onEnrolled }) {
  const [sequences, setSequences] = useState([])
  const [selectedSequence, setSelectedSequence] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isOpen) {
      fetchSequences()
      setSelectedSequence('')
      setError(null)
    }
  }, [isOpen])

  const fetchSequences = async () => {
    try {
      const res = await fetch(`${API_URL}/api/sequences`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('resiq_token')}` }
      })
      if (res.ok) {
        const data = await res.json()
        setSequences(data)
        if (data.length > 0) {
          setSelectedSequence(data[0].id)
        }
      }
    } catch (err) {
      console.error('Error fetching sequences', err)
      setError('Failed to load sequences.')
    }
  }

  const handleEnroll = async () => {
    if (!selectedSequence) return

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_URL}/api/sequences/${selectedSequence}/enroll`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('resiq_token')}` 
        },
        body: JSON.stringify({ contactId: contact.id })
      })

      if (!res.ok) throw new Error('Failed to enroll contact')

      onEnrolled()
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen || !contact) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={onClose}></div>
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
        
        <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6 border border-gray-200">
          <div className="flex justify-between items-center pb-4 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
              Enroll Contact in Sequence
            </h3>
            <button onClick={onClose} className="rounded-md text-gray-400 hover:text-gray-500">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="mt-4">
            <p className="text-sm text-gray-600 mb-4">
              Select an automated sequence to enroll <strong>{contact.name || contact.email}</strong> in.
            </p>

            {error && (
              <div className="mb-4 bg-red-50 text-red-700 p-3 rounded text-sm">
                {error}
              </div>
            )}

            {sequences.length === 0 ? (
              <div className="text-center p-4 bg-gray-50 rounded border border-gray-200 text-sm text-gray-500">
                You haven't created any sequences yet. Create one from the Sequences page.
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Sequence</label>
                <select
                  value={selectedSequence}
                  onChange={(e) => setSelectedSequence(e.target.value)}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                >
                  {sequences.map(seq => (
                    <option key={seq.id} value={seq.id}>
                      {seq.name} ({seq.step_count} steps)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-6 sm:mt-6 sm:flex sm:flex-row-reverse border-t border-gray-100 pt-4">
            <button
              type="button"
              disabled={isLoading || sequences.length === 0}
              onClick={handleEnroll}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
            >
              {isLoading ? 'Enrolling...' : 'Enroll Now'}
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
