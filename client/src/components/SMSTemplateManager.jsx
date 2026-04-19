import React, { useState, useEffect } from 'react';
import axios from 'axios';

/**
 * SMSTemplateManager
 * Admin page to create, edit, and delete SMS templates
 */
function SMSTemplateManager() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    content: '',
    description: '',
    variables: []
  });

  useEffect(() => {
    fetchTemplates();
  }, []);

  /**
   * Fetch all templates
   */
  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await axios.get('/api/sms/templates');
      setTemplates(response.data.templates || []);
    } catch (err) {
      console.error('Failed to load templates:', err);
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Extract variables from content
   */
  const extractVariablesFromContent = (content) => {
    const variables = [];
    const regex = /\{\{(\w+)\}\}/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }

    return variables;
  };

  /**
   * Validate form
   */
  const validateForm = () => {
    const errors = {};

    if (!formData.name.trim()) {
      errors.name = 'Template name is required';
    }

    if (!formData.slug.trim()) {
      errors.slug = 'Template slug is required';
    } else if (!/^[a-z0-9_-]+$/.test(formData.slug)) {
      errors.slug = 'Slug must be lowercase letters, numbers, hyphens, and underscores only';
    }

    if (!formData.content.trim()) {
      errors.content = 'Template content is required';
    }

    // Check for unmatched braces
    const openBraces = (formData.content.match(/\{\{/g) || []).length;
    const closeBraces = (formData.content.match(/\}\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.content = 'Unmatched curly braces in template content';
    }

    // Check slug uniqueness (excluding current edit)
    const slugExists = templates.some(t => t.slug === formData.slug && t.id !== editingId);
    if (slugExists) {
      errors.slug = 'This slug is already in use';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /**
   * Handle form submit
   */
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setError('');

      const variables = extractVariablesFromContent(formData.content);
      const payload = {
        ...formData,
        variables
      };

      let response;
      if (editingId) {
        response = await axios.patch(
          `/api/sms/templates/${editingId}`,
          payload
        );
      } else {
        response = await axios.post('/api/sms/templates', payload);
      }

      if (response.data.success) {
        await fetchTemplates();
        resetForm();
        setShowForm(false);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save template');
    }
  };

  /**
   * Handle edit
   */
  const handleEdit = (template) => {
    setEditingId(template.id);
    setFormData({
      name: template.name,
      slug: template.slug,
      content: template.content,
      description: template.description || '',
      variables: template.variables || []
    });
    setShowForm(true);
    setValidationErrors({});
  };

  /**
   * Handle delete
   */
  const handleDelete = async (templateId) => {
    if (!window.confirm('Are you sure? This cannot be undone.')) {
      return;
    }

    try {
      setError('');

      const response = await axios.delete(`/api/sms/templates/${templateId}`);

      if (response.data.success) {
        await fetchTemplates();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete template');
    }
  };

  /**
   * Reset form
   */
  const resetForm = () => {
    setFormData({
      name: '',
      slug: '',
      content: '',
      description: '',
      variables: []
    });
    setEditingId(null);
    setValidationErrors({});
  };

  /**
   * Cancel edit
   */
  const handleCancel = () => {
    resetForm();
    setShowForm(false);
    setError('');
  };

  if (loading) {
    return (
      <div className="p-6 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p className="text-gray-600 mt-2">Loading templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">SMS Templates</h1>
          <p className="text-gray-600 mt-1">Create and manage SMS message templates</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
          >
            + New Template
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            {editingId ? 'Edit Template' : 'Create New Template'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Template Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Proposal Sent"
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  validationErrors.name ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {validationErrors.name && (
                <p className="text-red-600 text-sm mt-1">{validationErrors.name}</p>
              )}
            </div>

            {/* Slug */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Template Slug (unique identifier)
              </label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) =>
                  setFormData({ ...formData, slug: e.target.value.toLowerCase() })
                }
                placeholder="e.g., proposal_sent"
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  validationErrors.slug ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {validationErrors.slug && (
                <p className="text-red-600 text-sm mt-1">{validationErrors.slug}</p>
              )}
            </div>

            {/* Content */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Template Content
              </label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Use {{variableName}} for dynamic content"
                rows="6"
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm resize-none ${
                  validationErrors.content ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {validationErrors.content && (
                <p className="text-red-600 text-sm mt-1">{validationErrors.content}</p>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Max 160 characters (will split into multiple messages if longer)
              </p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What is this template for?"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Preview and Variables */}
            {formData.content && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preview
                  </label>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 min-h-24 max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                    {formData.content}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Variables
                  </label>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                    {extractVariablesFromContent(formData.content).length === 0 ? (
                      <p className="text-gray-600">No variables in template</p>
                    ) : (
                      <ul className="space-y-1">
                        {extractVariablesFromContent(formData.content).map(v => (
                          <li key={v} className="text-blue-700 font-mono">
                            {'{{'}{v}{'}}'}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
              >
                {editingId ? 'Save Changes' : 'Create Template'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Templates Grid */}
      {!showForm && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {templates.map(template => (
            <div key={template.id} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{template.name}</h3>
                  {template.description && (
                    <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                  )}
                  <p className="text-xs text-gray-500 font-mono mt-2">slug: {template.slug}</p>
                </div>
                {template.is_default && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                    Default
                  </span>
                )}
              </div>

              <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 max-h-24 overflow-y-auto whitespace-pre-wrap break-words">
                {template.content}
              </div>

              {template.variables && template.variables.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-gray-600 mb-2">Variables:</p>
                  <div className="flex flex-wrap gap-1">
                    {template.variables.map(v => (
                      <span
                        key={v}
                        className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-mono rounded border border-blue-200"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-gray-200">
                {!template.is_default && (
                  <>
                    <button
                      onClick={() => handleEdit(template)}
                      className="px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition text-sm font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition text-sm font-medium"
                    >
                      Delete
                    </button>
                  </>
                )}
                {template.is_default && (
                  <button
                    onClick={() => handleEdit(template)}
                    className="px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition text-sm font-medium"
                  >
                    View
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {templates.length === 0 && !showForm && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-gray-600 mb-4">No templates yet</p>
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
          >
            Create Your First Template
          </button>
        </div>
      )}
    </div>
  );
}

export default SMSTemplateManager;
