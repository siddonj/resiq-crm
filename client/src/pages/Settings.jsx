import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'
import GmailConnect from '../components/GmailConnect'
import { useAuth } from '../context/AuthContext'

export default function Settings() {
  const [searchParams] = useSearchParams()
  const { token, user } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const success = searchParams.get('success')
  const error = searchParams.get('error')

  const [profile, setProfile] = useState({ name: user?.name || '', email: user?.email || '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')

  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState('')

  useEffect(() => {
    if (success || error) {
      setTimeout(() => window.history.replaceState({}, document.title, '/settings'), 3000)
    }
  }, [success, error])

  const handleProfileSave = async (e) => {
    e.preventDefault()
    setProfileMsg('')
    setProfileSaving(true)
    try {
      await axios.put('/api/users/me', { name: profile.name, email: profile.email }, headers)
      setProfileMsg('Profile updated.')
    } catch (err) {
      setProfileMsg(err.response?.data?.error || 'Failed to update profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  const handlePasswordSave = async (e) => {
    e.preventDefault()
    setPwMsg('')
    if (passwords.new_password !== passwords.confirm) {
      setPwMsg('New passwords do not match.')
      return
    }
    setPwSaving(true)
    try {
      await axios.put('/api/users/me/password', {
        current_password: passwords.current_password,
        new_password: passwords.new_password,
      }, headers)
      setPwMsg('Password updated.')
      setPasswords({ current_password: '', new_password: '', confirm: '' })
    } catch (err) {
      setPwMsg(err.response?.data?.error || 'Failed to update password.')
    } finally {
      setPwSaving(false)
    }
  }

  const isSuccess = (msg) => msg === 'Profile updated.' || msg === 'Password updated.'

  return (
    <div className="p-8">
      <h2 className="font-syne text-2xl font-bold text-navy mb-6">Settings</h2>

      {success && (
        <div className="mb-6 px-4 py-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          ✅ {decodeURIComponent(success)}
        </div>
      )}
      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          ⚠️ {decodeURIComponent(error)}
        </div>
      )}

      <div className="space-y-8 max-w-2xl">
        {/* Profile */}
        <div>
          <h3 className="font-syne text-lg font-semibold text-navy mb-4">Profile</h3>
          <div className="bg-white rounded-xl shadow-sm p-6">
            {profileMsg && (
              <p className={`text-sm mb-4 ${isSuccess(profileMsg) ? 'text-green-600' : 'text-red-500'}`}>{profileMsg}</p>
            )}
            <form onSubmit={handleProfileSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input
                  type="text"
                  value={profile.name}
                  onChange={e => setProfile({ ...profile, name: e.target.value })}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  value={profile.email}
                  onChange={e => setProfile({ ...profile, email: e.target.value })}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                />
              </div>
              <button
                type="submit"
                disabled={profileSaving}
                className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors"
              >
                {profileSaving ? 'Saving...' : 'Save Profile'}
              </button>
            </form>
          </div>
        </div>

        {/* Password */}
        <div>
          <h3 className="font-syne text-lg font-semibold text-navy mb-4">Change Password</h3>
          <div className="bg-white rounded-xl shadow-sm p-6">
            {pwMsg && (
              <p className={`text-sm mb-4 ${isSuccess(pwMsg) ? 'text-green-600' : 'text-red-500'}`}>{pwMsg}</p>
            )}
            <form onSubmit={handlePasswordSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Current Password</label>
                <input
                  type="password"
                  value={passwords.current_password}
                  onChange={e => setPasswords({ ...passwords, current_password: e.target.value })}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
                <input
                  type="password"
                  value={passwords.new_password}
                  onChange={e => setPasswords({ ...passwords, new_password: e.target.value })}
                  required
                  minLength={8}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={passwords.confirm}
                  onChange={e => setPasswords({ ...passwords, confirm: e.target.value })}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                />
              </div>
              <button
                type="submit"
                disabled={pwSaving}
                className="px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors"
              >
                {pwSaving ? 'Saving...' : 'Change Password'}
              </button>
            </form>
          </div>
        </div>

        {/* Integrations */}
        <div>
          <h3 className="font-syne text-lg font-semibold text-navy mb-4">Integrations</h3>
          <GmailConnect />
        </div>

        {/* About */}
        <div className="border-t border-gray-100 pt-6">
          <h3 className="font-syne text-lg font-semibold text-navy mb-4">About</h3>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <p className="text-sm text-brand-gray mb-2"><strong>ResiQ CRM</strong> v0.1.0</p>
            <p className="text-xs text-gray-500">A lightweight CRM for property tech professionals. All data is stored securely and encrypted.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
