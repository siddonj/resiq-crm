import { useState, useEffect } from 'react'
import { useClientAuth } from '../context/ClientAuthContext'

export default function ClientProposals() {
  const { token } = useClientAuth()
  const [proposals, setProposals] = useState([])
  const [selectedProposal, setSelectedProposal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signingProposal, setSigningProposal] = useState(null)
  const [signatureName, setSignatureName] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  useEffect(() => {
    fetchProposals()
  }, [token])

  const fetchProposals = async () => {
    try {
      setLoading(true)
      const res = await fetch('http://localhost:5000/api/client/proposals', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setProposals(data)
      } else {
        setError('Failed to load proposals')
      }
    } catch (err) {
      console.error('Error fetching proposals:', err)
      setError('Failed to load proposals')
    } finally {
      setLoading(false)
    }
  }

  const handleSignProposal = async (proposalId) => {
    if (!signatureName.trim()) {
      setError('Please enter your name to sign')
      return
    }

    try {
      setSigningProposal(proposalId)
      const res = await fetch(`http://localhost:5000/api/client/proposals/${proposalId}/sign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ signatureName }),
      })

      if (res.ok) {
        const updated = await res.json()
        setProposals(proposals.map((p) => (p.id === proposalId ? updated : p)))
        setSelectedProposal(updated)
        setSignatureName('')
        setError('')
      } else {
        setError('Failed to sign proposal')
      }
    } catch (err) {
      console.error('Error signing proposal:', err)
      setError('Failed to sign proposal')
    } finally {
      setSigningProposal(null)
    }
  }

  const filteredProposals = filterStatus === 'all' ? proposals : proposals.filter((p) => p.status === filterStatus)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading proposals...</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Proposals List */}
      <div className="lg:col-span-1">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Proposals</h2>

            {/* Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
            >
              <option value="all">All Proposals</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="viewed">Viewed</option>
              <option value="signed">Signed</option>
              <option value="declined">Declined</option>
            </select>
          </div>

          {filteredProposals.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No proposals</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredProposals.map((proposal) => (
                <button
                  key={proposal.id}
                  onClick={() => setSelectedProposal(proposal)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                    selectedProposal?.id === proposal.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="font-medium text-gray-900 truncate">{proposal.title}</p>
                  <p className="text-sm text-gray-500">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        proposal.status === 'signed'
                          ? 'bg-green-100 text-green-800'
                          : proposal.status === 'declined'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                    </span>
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Proposal Detail */}
      <div className="lg:col-span-2">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {selectedProposal ? (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
              <h1 className="text-2xl font-bold">{selectedProposal.title}</h1>
              <p className="text-blue-100 mt-2">
                Created {new Date(selectedProposal.created_at).toLocaleDateString()}
              </p>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Status */}
              <div>
                <p className="text-gray-600 text-sm font-medium mb-2">Status</p>
                <span
                  className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                    selectedProposal.status === 'signed'
                      ? 'bg-green-100 text-green-800'
                      : selectedProposal.status === 'declined'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {selectedProposal.status.charAt(0).toUpperCase() + selectedProposal.status.slice(1)}
                </span>
              </div>

              {/* Sections */}
              {selectedProposal.sections && selectedProposal.sections.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Sections</h3>
                  <div className="space-y-4">
                    {selectedProposal.sections.map((section, idx) => (
                      <div key={idx} className="border-l-4 border-blue-600 pl-4">
                        <h4 className="font-medium text-gray-900">{section.title}</h4>
                        <p className="text-gray-600 text-sm mt-1">{section.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Line Items */}
              {selectedProposal.line_items && selectedProposal.line_items.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-900 mb-3">Pricing</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 text-gray-600 font-medium">Item</th>
                          <th className="text-right py-2 text-gray-600 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProposal.line_items.map((item, idx) => (
                          <tr key={idx} className="border-b border-gray-100">
                            <td className="py-2 text-gray-900">{item.description}</td>
                            <td className="text-right text-gray-900">${item.amount?.toFixed(2) || '0.00'}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="py-3 font-bold text-gray-900">Total</td>
                          <td className="text-right py-3 font-bold text-lg">
                            $
                            {selectedProposal.line_items
                              .reduce((sum, item) => sum + (item.amount || 0), 0)
                              .toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Signature */}
              {selectedProposal.status === 'signed' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-1">Signed by</p>
                  <p className="font-bold text-gray-900">{selectedProposal.signature_name}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {new Date(selectedProposal.signed_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
              )}

              {/* Sign Form */}
              {selectedProposal.status !== 'signed' && selectedProposal.status !== 'declined' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-bold text-gray-900 mb-3">Sign Proposal</h3>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                      placeholder="Your full name"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                    <button
                      onClick={() => handleSignProposal(selectedProposal.id)}
                      disabled={signingProposal === selectedProposal.id || !signatureName.trim()}
                      className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      {signingProposal === selectedProposal.id ? 'Signing...' : '✓ Sign Proposal'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
            <p>Select a proposal to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}
