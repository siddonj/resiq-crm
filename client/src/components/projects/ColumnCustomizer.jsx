import { useState } from 'react'

const COLUMN_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'status', label: 'Status' },
]

export default function ColumnCustomizer({ columns = [], onAddColumn, onDeleteColumn }) {
  const [form, setForm] = useState({ name: '', type: 'text', options: '' })
  const [error, setError] = useState('')

  const handleAdd = () => {
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    const config = {}
    if (form.type === 'dropdown' || form.type === 'status') {
      const opts = form.options
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      config.options = opts
    }

    onAddColumn({ name: form.name.trim(), type: form.type, config })
    setForm({ name: '', type: 'text', options: '' })
    setError('')
  }

  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <h3 className="text-base font-semibold text-gray-900">Columns</h3>
      <p className="text-sm text-gray-600">Configure fields for this project.</p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input
            className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Status"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Type</label>
          <select
            className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {COLUMN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        {(form.type === 'dropdown' || form.type === 'status') && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Options (comma-separated)</label>
            <input
              className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              value={form.options}
              onChange={(e) => setForm({ ...form, options: e.target.value })}
              placeholder="Not Started, In Progress, Blocked, Done"
            />
          </div>
        )}
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          onClick={handleAdd}
          className="w-full inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
        >
          Add Column
        </button>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold text-gray-800">Current Columns</h4>
        {columns.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No columns yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {columns.map((col) => (
              <li key={col.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                <div>
                  <div className="font-medium text-gray-900">{col.name}</div>
                  <div className="text-xs text-gray-500">{col.type}</div>
                </div>
                <button
                  onClick={() => onDeleteColumn(col.id)}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
