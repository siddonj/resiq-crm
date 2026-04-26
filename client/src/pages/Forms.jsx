import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function Forms() {
  const { token, user } = useAuth()
  const [forms, setForms] = useState([])
  const [title, setTitle] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchForms = () => {
    axios.get('/api/forms', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setForms(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchForms()
  }, [token])

  const createForm = async (e) => {
    e.preventDefault()
    if (!title) return setError('Title is required')
    setError('')
    try {
      const res = await axios.post('/api/forms', { title, redirect_url: redirectUrl, fields: customFields }, { headers: { Authorization: `Bearer ${token}` } })
      setForms([res.data, ...forms])
      setTitle('')
      setRedirectUrl('')
      setCustomFields([])
    } catch (err) {
      setError('Failed to create form')
    }
  }

  const deleteForm = async (id) => {
    if (!window.confirm('Delete this form? Embeds will stop working.')) return
    try {
      await axios.delete(`/api/forms/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      setForms(forms.filter(f => f.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  const [customFields, setCustomFields] = useState([])
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState('text')

  const addCustomField = () => {
    if (!newFieldName) return
    const key = newFieldName.toLowerCase().replace(/[^a-z0-9]/g, '_')
    setCustomFields([...customFields, { label: newFieldName, key, type: newFieldType }])
    setNewFieldName('')
  }
  
  const removeCustomField = (index) => {
    setCustomFields(customFields.filter((_, i) => i !== index))
  }

  const buildEmbedCode = (formObj) => {
    if (!formObj) return ''
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'
    const extraFields = (formObj.fields || []).map(f => `
  <div style="margin-bottom: 12px;">
    <input type="${f.type === 'number' ? 'number' : 'text'}" name="${f.key}" placeholder="${f.label}" ${f.required ? 'required' : ''} style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
  </div>`).join('')

    return `<form action="${apiUrl}/api/leads/${formObj.id}" method="POST" style="max-width: 400px; margin: 0 auto; font-family: sans-serif;">
  <div style="margin-bottom: 12px;">
    <input type="text" name="name" placeholder="Full Name" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
  </div>
  <div style="margin-bottom: 12px;">
    <input type="email" name="email" placeholder="Email Address" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
  </div>
  <div style="margin-bottom: 12px;">
    <input type="tel" name="phone" placeholder="Phone Number" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
  </div>
  <div style="margin-bottom: 12px;">
    <input type="text" name="company" placeholder="Company Name" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
  </div>${extraFields}
  <div style="margin-bottom: 12px;">
    <textarea name="notes" placeholder="How can we help?" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; min-height: 80px;"></textarea>
  </div>
  <button type="submit" style="width: 100%; padding: 10px; background-color: #0f1f3d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Submit Request</button>
</form>`
  }

  const [editingHtml, setEditingHtml] = useState({})

  const handleHtmlEdit = (id, newHtml) => {
    setEditingHtml(prev => ({ ...prev, [id]: newHtml }))
  }

  const getHtml = (formObj) => {
    if (!formObj) return ''
    return editingHtml[formObj.id] ?? buildEmbedCode(formObj)
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    alert('Embed snippet copied to clipboard!')
  }

  const [suggestions, setSuggestions] = useState({})
  const [askingAi, setAskingAi] = useState(false)

  const askAiForSuggestions = async (formTitle, formId) => {
    setAskingAi(formId)
    try {
      const res = await axios.post('/api/agents/form-suggestions', { title: formTitle }, { headers: { Authorization: `Bearer ${token}` } })
      setSuggestions({ ...suggestions, [formId]: res.data })
    } catch (err) {
      alert('Failed to get suggestions')
    } finally {
      setAskingAi(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h2 className="text-2xl font-bold mb-2 font-syne text-navy">Web-to-Lead Forms</h2>
      <p className="text-gray-600 mb-8">
        Create HTML forms to embed on your website (WordPress, Webflow, etc.). When visitors submit the form, they instantly become Contacts and Deals in the Pipeline.
      </p>

      {/* Builder */}
      <form onSubmit={createForm} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-10">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Create New Form</h3>
        {error && <p className="text-red-600 mb-4">{error}</p>}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Form Name (Internal)</label>
            <input 
              type="text" 
              className="w-full border border-gray-300 rounded p-2 focus:ring-teal focus:border-teal" 
              placeholder="e.g. Homepage Contact Form"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Redirect URL (Optional)</label>
            <input 
              type="url" 
              className="w-full border border-gray-300 rounded p-2 focus:ring-teal focus:border-teal" 
              placeholder="https://yourwebsite.com/thank-you"
              value={redirectUrl}
              onChange={e => setRedirectUrl(e.target.value)}
            />
          </div>
        </div>

        {/* Custom Fields section inline */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Additional Custom Fields</label>
          
          {customFields.length > 0 && (
            <div className="space-y-2 mb-3">
              {customFields.map((f, i) => (
                <div key={i} className="flex items-center space-x-2 bg-gray-50 border border-gray-200 p-2 rounded">
                  <span className="text-sm font-medium text-gray-700 w-1/3">{f.label} ({f.type})</span>
                  <span className="text-xs text-gray-400 w-1/3 font-mono">key: {f.key}</span>
                  <button type="button" onClick={() => removeCustomField(i)} className="text-red-500 hover:text-red-700 text-xs ml-auto">Remove</button>
                </div>
              ))}
            </div>
          )}
          
          <div className="flex space-x-2">
            <input 
              type="text" 
              placeholder="E.g. Lead Source" 
              className="flex-1 border border-gray-300 rounded p-2 text-sm focus:ring-teal focus:border-teal"
              value={newFieldName}
              onChange={e => setNewFieldName(e.target.value)}
            />
            <select 
              className="border border-gray-300 rounded p-2 text-sm focus:ring-teal focus:border-teal"
              value={newFieldType}
              onChange={e => setNewFieldType(e.target.value)}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
            </select>
            <button type="button" onClick={addCustomField} className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium px-3 py-2 rounded text-sm transition">
              Add Field
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">These will be saved to `custom_fields` on new Contacts & Deals.</p>
        </div>

        <button type="submit" className="bg-teal hover:bg-teal/90 text-white font-bold py-2 px-4 rounded">
          Generate Form
        </button>
      </form>

      {/* List */}
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Your Active Forms</h3>
      {loading ? (
        <p>Loading forms...</p>
      ) : forms.length === 0 ? (
        <p className="text-gray-500">No forms created yet. Create one above to get the snippet!</p>
      ) : (
        <div className="space-y-6">
          {forms.map(form => (
            <div key={form.id} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 relative">
              <button 
                onClick={() => deleteForm(form.id)}
                className="absolute top-4 right-4 text-red-500 hover:text-red-700 text-sm font-medium"
              >
                Delete Form
              </button>
              <h4 className="font-bold text-navy mb-1">{form.title}</h4>
              <p className="text-sm text-gray-500 mb-4">Redirects to: {form.redirect_url || 'Default Success Page'}</p>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                {/* HTML Editor */}
                <div className="flex flex-col bg-gray-50 rounded-lg p-4 relative border border-gray-200">
                  <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Edit HTML</h5>
                  <button 
                    onClick={() => copyToClipboard(getHtml(form))}
                    className="absolute top-3 right-3 bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 font-medium rounded text-xs transition"
                  >
                    Copy Embed
                  </button>
                  <textarea 
                    className="w-full flex-1 text-xs text-gray-800 font-mono bg-white border border-gray-300 rounded p-3 focus:outline-none focus:ring-1 focus:ring-teal resize-none min-h-[300px]"
                    value={getHtml(form)}
                    onChange={(e) => handleHtmlEdit(form.id, e.target.value)}
                    spellCheck="false"
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    Tip: Do not remove the `action` URL or `name` attributes.
                  </p>
                </div>

                {/* Live Preview */}
                <div className="flex flex-col bg-white rounded-lg p-4 border border-gray-200">
                  <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4">Live Preview</h5>
                  <div 
                    className="flex-1 w-full flex items-center justify-center p-4 bg-gray-50 rounded border border-dashed border-gray-300 overflow-y-auto max-h-[350px]"
                    dangerouslySetInnerHTML={{ __html: getHtml(form) }} 
                  />
                </div>
              </div>

              {/* AI Suggestions Block */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                {!suggestions[form.id] ? (
                  <button 
                    onClick={() => askAiForSuggestions(form.title, form.id)}
                    disabled={askingAi === form.id}
                    className="flex items-center text-teal-600 hover:text-teal-800 font-medium text-sm transition"
                  >
                    {askingAi === form.id ? 'Thinking...' : '✨ Ask AI what to do with this form'}
                  </button>
                ) : (
                  <div className="bg-teal-50/50 p-4 rounded-lg border border-teal-100 text-sm">
                    <h5 className="font-bold text-teal-800 mb-3 flex items-center">
                      ✨ AI Marketing Strategy
                    </h5>
                    
                    <div className="mb-3">
                      <strong className="text-gray-700 block mb-1">Headline & Subheadline for your page:</strong>
                      <p className="text-gray-800 font-medium">{suggestions[form.id].headline}</p>
                      <p className="text-gray-600 italic">"{suggestions[form.id].subheadline}"</p>
                    </div>

                    <div className="mb-3">
                      <strong className="text-gray-700 block mb-1">Ideas for a Lead Magnet (Offer):</strong>
                      <ul className="list-disc pl-5 text-gray-800 space-y-1 mt-1">
                        {suggestions[form.id].leadMagnets?.map((idea, i) => (
                          <li key={i}>{idea}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <strong className="text-gray-700 inline">Suggested Button Text: </strong>
                      <span className="font-mono bg-white border border-gray-200 px-2 py-0.5 rounded text-teal-700">{suggestions[form.id].cta}</span>
                    </div>
                  </div>
                )}
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  )
}
