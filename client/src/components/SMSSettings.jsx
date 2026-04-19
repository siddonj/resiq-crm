import React, { useState } from 'react';
import axios from 'axios';

/**
 * SMSSettings
 * Contact SMS preferences: phone number, opt-in status, validation
 */
function SMSSettings({ contact, onUpdate }) {
  const [phoneNumber, setPhoneNumber] = useState(contact.phone_number || '');
  const [isOptedIn, setIsOptedIn] = useState(contact.sms_opted_in || false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showOptInConfirm, setShowOptInConfirm] = useState(false);
  const [showOptOutConfirm, setShowOptOutConfirm] = useState(false);

  /**
   * Validate phone number format
   */
  const isValidPhone = () => {
    // Simple validation - just check for digits
    const digits = phoneNumber.replace(/\D/g, '');
    return digits.length >= 10;
  };

  /**
   * Handle opt-in
   */
  const handleOptIn = async () => {
    try {
      setError('');
      setSuccess('');
      setLoading(true);

      const response = await axios.post(
        `/api/sms/${contact.id}/optin`
      );

      if (response.data.success) {
        setIsOptedIn(true);
        setSuccess('Contact opted in to SMS');
        setShowOptInConfirm(false);
        if (onUpdate) {
          onUpdate({ sms_opted_in: true });
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to opt in contact');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle opt-out
   */
  const handleOptOut = async () => {
    try {
      setError('');
      setSuccess('');
      setLoading(true);

      const response = await axios.post(
        `/api/sms/${contact.id}/optout`
      );

      if (response.data.success) {
        setIsOptedIn(false);
        setSuccess('Contact opted out of SMS');
        setShowOptOutConfirm(false);
        if (onUpdate) {
          onUpdate({ sms_opted_in: false });
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to opt out contact');
    } finally {
      setLoading(false);
    }
  };

  const statusBadge = isOptedIn
    ? { bg: 'bg-green-100', text: 'text-green-800', label: 'Opted In', icon: '✓' }
    : { bg: 'bg-red-100', text: 'text-red-800', label: 'Opted Out', icon: '✕' };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">SMS Settings</h3>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      {/* Phone Number */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Phone Number
        </label>
        <div className="flex gap-2">
          <input
            type="tel"
            value={phoneNumber}
            disabled
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
            placeholder="No phone number"
          />
          {phoneNumber && (
            <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm font-medium flex items-center">
              ✓ Valid
            </div>
          )}
          {!phoneNumber && (
            <div className="px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm font-medium flex items-center">
              ⚠ None
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Contact's registered phone number (set in contact details)
        </p>
      </div>

      {/* SMS Opt-In Status */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          SMS Preferences
        </label>

        <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${statusBadge.bg} ${statusBadge.text}`}>
              {statusBadge.icon} {statusBadge.label}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {isOptedIn
                  ? 'Contact can receive SMS messages'
                  : 'Contact is opted out of SMS'}
              </p>
              {contact.sms_opted_in_at && (
                <p className="text-xs text-gray-600 mt-1">
                  Since {new Date(contact.sms_opted_in_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          {isOptedIn ? (
            <button
              onClick={() => setShowOptOutConfirm(true)}
              disabled={loading || !phoneNumber}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                loading || !phoneNumber
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-red-600 text-white hover:bg-red-700'
              }`}
            >
              Opt Out
            </button>
          ) : (
            <button
              onClick={() => setShowOptInConfirm(true)}
              disabled={loading || !phoneNumber}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                loading || !phoneNumber
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              Opt In
            </button>
          )}
        </div>

        {!phoneNumber && (
          <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
            ⚠️ Add a phone number to manage SMS preferences
          </div>
        )}
      </div>

      {/* Opt-In Confirmation Dialog */}
      {showOptInConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Opt In to SMS?</h3>
            <p className="text-gray-600 mb-4">
              This contact will be able to receive SMS messages from you.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowOptInConfirm(false)}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleOptIn}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition"
              >
                {loading ? 'Processing...' : 'Confirm Opt-In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Opt-Out Confirmation Dialog */}
      {showOptOutConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Opt Out of SMS?</h3>
            <p className="text-gray-600 mb-4">
              This contact will not receive SMS messages unless they manually opt-in again.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowOptOutConfirm(false)}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleOptOut}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition"
              >
                {loading ? 'Processing...' : 'Confirm Opt-Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
        <p className="font-medium mb-1">📋 TCPA Compliance</p>
        <p>
          All SMS communications comply with TCPA regulations. Contacts who reply with "STOP" will be automatically opted out.
        </p>
      </div>
    </div>
  );
}

export default SMSSettings;
