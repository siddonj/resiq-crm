import { useState, useEffect } from 'react'
import SequenceBuilderModal from '../components/SequenceBuilderModal'
import { PlusIcon, PlayIcon, PauseIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export default function Sequences() {
  const [sequences, setSequences] = useState([])
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [editingSequence, setEditingSequence] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')

  const fetchSequences = async () => {
    try {
      const res = await fetch(`${API_URL}/api/sequences`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('resiq_token')}` }
      })
      if (res.ok) {
        const data = await res.json()
        setSequences(data)
      }
    } catch (err) {
      console.error('Error fetching sequences', err)
    }
  }

  useEffect(() => {
    fetchSequences()
  }, [])

  const handleEdit = (seq) => {
    setEditingSequence(seq)
    setIsBuilderOpen(true)
  }

  const handleCreate = () => {
    setEditingSequence(null)
    setIsBuilderOpen(true)
  }

  const filteredSequences = sequences.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (s.description && s.description.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span>✉️</span> Automations & Sequences
          </h1>
          <p className="mt-2 text-sm text-gray-700">
            Create automated, multi-touch email and SMS drip campaigns to nurture your contacts.
          </p>
        </div>
        <div className="mt-4 sm:mt-0">
          <button
            onClick={handleCreate}
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none"
          >
            <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
            New Sequence
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1 max-w-lg">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="Search sequences..."
          />
        </div>
      </div>

      {/* Sequence List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md mt-4">
        <ul className="divide-y divide-gray-200">
          {filteredSequences.length === 0 ? (
            <li className="p-8 text-center text-gray-500">
              No sequences found. Create one to get started.
            </li>
          ) : (
            filteredSequences.map((seq) => (
              <li key={seq.id}>
                <div 
                  className="block hover:bg-gray-50 cursor-pointer p-4 sm:px-6"
                  onClick={() => handleEdit(seq)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <p className="text-sm font-medium text-indigo-600 truncate">{seq.name}</p>
                      <p className="mt-1 text-sm text-gray-500">{seq.description}</p>
                    </div>
                    <div className="flex flex-col flex-shrink-0 gap-2 items-end">
                      <div className="flex space-x-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {seq.step_count || 0} Steps
                        </span>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          {seq.active_enrollments || 0} Active
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      {isBuilderOpen && (
        <SequenceBuilderModal
          isOpen={isBuilderOpen}
          onClose={() => setIsBuilderOpen(false)}
          onSaved={() => {
            setIsBuilderOpen(false)
            fetchSequences()
          }}
          sequence={editingSequence}
        />
      )}
    </div>
  )
}
