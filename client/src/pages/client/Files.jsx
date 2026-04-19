import { useState, useEffect } from 'react'
import { useClientAuth } from '../../context/ClientAuthContext'

export default function ClientFiles() {
  const { token } = useClientAuth()
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchFiles()
  }, [token])

  const fetchFiles = async () => {
    try {
      setLoading(true)
      const res = await fetch('http://localhost:5000/api/client/files', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setFiles(data)
      } else {
        setError('Failed to load files')
      }
    } catch (err) {
      console.error('Error fetching files:', err)
      setError('Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (fileId, fileName) => {
    try {
      const res = await fetch(`http://localhost:5000/api/client/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) {
        const data = await res.json()
        // In a real app, download from S3 or cloud storage using data.file.path
        // For now, show message
        alert(`Download available: ${data.file.name}`)
      } else {
        setError('Failed to download file')
      }
    } catch (err) {
      console.error('Error downloading file:', err)
      setError('Failed to download file')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading files...</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Shared Files</h1>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {files.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-4xl mb-4">📁</p>
          <p className="text-gray-600 text-lg">No files have been shared with you yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {files.map((file) => (
            <div key={file.id} className="bg-white rounded-lg shadow p-4 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="text-3xl">📄</div>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                  {file.mime_type}
                </span>
              </div>

              <h3 className="font-bold text-gray-900 mb-1 break-words">{file.file_name}</h3>

              <div className="space-y-2 mb-4">
                <p className="text-sm text-gray-500">
                  {(file.file_size / 1024 / 1024).toFixed(2)} MB
                </p>
                <p className="text-xs text-gray-500">
                  Shared {new Date(file.shared_at).toLocaleDateString()}
                </p>
              </div>

              <button
                onClick={() => handleDownload(file.id, file.file_name)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                <span>⬇️</span>
                <span>Download</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
