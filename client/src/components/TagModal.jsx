import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function TagModal({ contactId, tags, onClose, onTagAdded }) {
  const { token } = useAuth()
  const [allTags, setAllTags] = useState([])
  const [newTagName, setNewTagName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    fetchAllTags()
  }, [])

  const fetchAllTags = async () => {
    try {
      const res = await axios.get('/api/contacts/tags', authHeaders)
      setAllTags(res.data)
      setLoading(false)
    } catch (err) {
      console.error('Error fetching tags:', err)
      setLoading(false)
    }
  }

  const handleCreateTag = async (e) => {
    e.preventDefault()
    if (!newTagName.trim()) return

    try {
      const res = await axios.post('/api/contacts/tags', { name: newTagName }, authHeaders)
      setAllTags([...allTags, res.data])
      setNewTagName('')
      // Auto-add the new tag to the contact
      await handleAddTag(res.data.id)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create tag')
    }
  }

  const handleAddTag = async (tagId) => {
    try {
      await axios.post(`/api/contacts/${contactId}/tags`, { tag_id: tagId }, authHeaders)
      onTagAdded()
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add tag')
    }
  }

  const handleRemoveTag = async (tagId) => {
    try {
      await axios.delete(`/api/contacts/${contactId}/tags/${tagId}`, authHeaders)
      onTagAdded()
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove tag')
    }
  }

  const contactTagIds = tags.map(t => t.id)
  const availableTags = allTags.filter(t => !contactTagIds.includes(t.id))

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
          <h3 className="font-syne text-lg font-bold text-navy mb-4">Manage Tags</h3>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          {/* Current tags */}
          {tags.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-navy mb-2">Current Tags:</p>
              <div className="space-y-2">
                {tags.map((tag) => (
                  <div key={tag.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <span
                      className="px-2 py-1 text-xs font-medium rounded text-white"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                    </span>
                    <button
                      onClick={() => handleRemoveTag(tag.id)}
                      className="text-xs text-red-600 hover:text-red-700 font-semibold"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Available tags */}
          {availableTags.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-navy mb-2">Add Existing Tag:</p>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {availableTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => handleAddTag(tag.id)}
                    className="w-full text-left p-2 hover:bg-gray-100 rounded text-sm flex items-center gap-2"
                  >
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create new tag */}
          <form onSubmit={handleCreateTag} className="mb-4">
            <label className="text-xs font-semibold text-navy mb-2 block">Create New Tag:</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag name..."
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal"
              />
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-teal text-white rounded-lg hover:bg-teal/90 transition-colors"
              >
                Add
              </button>
            </div>
          </form>

          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </>
  )
}
