import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import TagModal from './TagModal'

export default function ContactTags({ contactId, onTagsUpdated }) {
  const { token } = useAuth()
  const [tags, setTags] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    fetchTags()
  }, [contactId])

  const fetchTags = async () => {
    try {
      const res = await axios.get(`/api/contacts/${contactId}/tags`, authHeaders)
      setTags(res.data)
      setLoading(false)
    } catch (err) {
      console.error('Error fetching tags:', err)
      setLoading(false)
    }
  }

  const handleTagAdded = () => {
    fetchTags()
    if (onTagsUpdated) onTagsUpdated()
  }

  if (loading) return <div className="text-xs text-brand-gray">Loading tags...</div>

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-block px-2 py-1 text-xs font-medium rounded-full text-white"
            style={{ backgroundColor: tag.color }}
          >
            {tag.name}
          </span>
        ))}
        <button
          onClick={() => setModalOpen(true)}
          className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
          title="Manage tags"
        >
          + Add
        </button>
      </div>

      {modalOpen && (
        <TagModal
          contactId={contactId}
          tags={tags}
          onClose={() => setModalOpen(false)}
          onTagAdded={handleTagAdded}
        />
      )}
    </>
  )
}
