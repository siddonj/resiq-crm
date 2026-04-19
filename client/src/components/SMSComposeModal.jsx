import React, { useState, useEffect } from 'react';
import axios from 'axios';

/**
 * SMSComposeModal
 * Modal for composing and sending SMS to a contact
 * Supports template selection with variable preview
 */
function SMSComposeModal({ contact, onClose, onSuccess }) {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [content, setContent] = useState('');
  const [variables, setVariables] = useState({});
  const [characterCount, setCharacterCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('template'); // 'template' or 'custom'

  useEffect(() => {
    // Fetch templates on mount
    const fetchTemplates = async () => {
      try {
        const response = await axios.get('/api/sms/templates');
        setTemplates(response.data.templates || []);
      } catch (err) {
        console.error('Failed to load templates:', err);
        setError('Failed to load templates');
      }
    };

    fetchTemplates();
  }, []);

  // Update character count when content changes
  useEffect(() => {
    const preview = getPreview();
    setCharacterCount(preview.length);
  }, [content, selectedTemplate, variables]);

  /**
   * Get current SMS preview (rendered content)
   */
  const getPreview = () => {
    let text = '';

    if (mode === 'template' && selectedTemplate) {
      text = renderTemplate(selectedTemplate.content, variables);
    } else {
      text = content;
    }

    return text;
  };

  /**
   * Render template with variables substituted
   */
  const renderTemplate = (template, vars = {}) => {
    let rendered = template;

    const variableRegex = /\{\{(\w+)\}\}/g;
    let match;

    while ((match = variableRegex.exec(template)) !== null) {
      const variable = match[1];
      const value = vars[variable] || `{{${variable}}}`;
      rendered = rendered.replace(`{{${variable}}}`, value);
    }

    return rendered;
  };

  /**
   * Extract variables from template
   */
  const extractVariables = (template) => {
    const vars = {};
    const variableRegex = /\{\{(\w+)\}\}/g;
    let match;

    while ((match = variableRegex.exec(template.content)) !== null) {
      const variable = match[1];
      if (!vars[variable]) {
        vars[variable] = '';
      }
    }

    return vars;
  };

  /**
   * Handle template selection
   */
  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setVariables(extractVariables(template));
    setMode('template');
    setContent('');
    setError('');
  };

  /**
   * Handle variable change
   */
  const handleVariableChange = (varName, value) => {
    setVariables(prev => ({
      ...prev,
      [varName]: value
    }));
  };

  /**
   * Switch to custom mode
   */
  const handleCustomMode = () => {
    setMode('custom');
    setSelectedTemplate(null);
    setVariables({});
    setError('');
  };

  /**
   * Send SMS
   */
  const handleSendSMS = async () => {
    try {
      setError('');
      setLoading(true);

      const preview = getPreview();

      if (!preview.trim()) {
        setError('SMS content cannot be empty');
        return;
      }

      const payload = {
        contactId: contact.id,
        ...(mode === 'template' ? { templateId: selectedTemplate.id, variables } : { content: preview })
      };

      const response = await axios.post('/api/sms/send', payload);

      if (response.data.success) {
        setContent('');
        setVariables({});
        setSelectedTemplate(null);
        if (onSuccess) {
          onSuccess(response.data.message);
        }
        onClose();
      } else {
        setError(response.data.error || 'Failed to send SMS');
      }
    } catch (err) {
      console.error('Send SMS error:', err);
      setError(err.response?.data?.error || 'Failed to send SMS');
    } finally {
      setLoading(false);
    }
  };

  const preview = getPreview();
  const canSend = preview.trim().length > 0 && !loading && contact.phone_number;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between border-b">
          <div>
            <h2 className="text-xl font-bold text-white">Send SMS</h2>
            <p className="text-blue-100 text-sm mt-1">{contact.name} • {contact.phone_number}</p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-blue-800 rounded-full p-2 transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {!contact.phone_number && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
              ⚠️ Contact has no phone number. Add one to send SMS.
            </div>
          )}

          {/* Mode Toggle */}
          <div className="mb-6 flex gap-2">
            <button
              onClick={() => setMode('template')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                mode === 'template'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Use Template
            </button>
            <button
              onClick={handleCustomMode}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                mode === 'custom'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Custom Message
            </button>
          </div>

          {/* Template Selection (Mode: Template) */}
          {mode === 'template' && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Template
              </label>
              <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
                {templates.length === 0 ? (
                  <p className="text-gray-500 text-sm">No templates available</p>
                ) : (
                  templates.map(template => (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className={`w-full text-left p-3 rounded-lg border-2 transition ${
                        selectedTemplate?.id === template.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="font-medium text-gray-900">{template.name}</div>
                      <div className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {template.content}
                      </div>
                      {template.description && (
                        <div className="text-xs text-gray-500 mt-1">{template.description}</div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Variables (Template Mode with selected template) */}
          {mode === 'template' && selectedTemplate && Object.keys(variables).length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Template Variables
              </label>
              <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-200">
                {Object.keys(variables).map(varName => (
                  <div key={varName}>
                    <label className="block text-sm text-gray-600 mb-1">
                      {varName}
                    </label>
                    <input
                      type="text"
                      value={variables[varName]}
                      onChange={(e) => handleVariableChange(varName, e.target.value)}
                      placeholder={`Enter ${varName}`}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom Message Textarea (Mode: Custom) */}
          {mode === 'custom' && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message Content
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Type your SMS message..."
                maxLength="160"
                rows="4"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>
          )}

          {/* Preview */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Message Preview
            </label>
            <div className="bg-gray-50 border-2 border-gray-200 rounded-lg p-4 min-h-24 max-h-40 overflow-y-auto">
              <p className="text-gray-900 leading-relaxed whitespace-pre-wrap break-words">
                {preview || <span className="text-gray-400 italic">Your message will appear here...</span>}
              </p>
            </div>
            <div className="mt-2 flex justify-between items-center">
              <span className={`text-sm ${characterCount > 160 ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                {characterCount} characters
                {characterCount > 160 && ` (${Math.ceil(characterCount / 160)} messages)`}
              </span>
              <span className="text-xs text-gray-500">Max 160 characters per message</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSendSMS}
              disabled={!canSend}
              className={`px-6 py-2 rounded-lg font-medium text-white transition ${
                canSend
                  ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                  : 'bg-gray-400 cursor-not-allowed opacity-50'
              }`}
            >
              {loading ? 'Sending...' : 'Send SMS'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SMSComposeModal;
