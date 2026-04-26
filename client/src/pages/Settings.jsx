import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'
import GmailConnect from '../components/GmailConnect'
import { useAuth } from '../context/AuthContext'

const ROLES = ['admin', 'manager', 'rep', 'user', 'viewer']

const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager',
  rep: 'Rep',
  user: 'Rep',
  viewer: 'Viewer',
}

export default function Settings() {
  const [searchParams] = useSearchParams()
  const { token, user } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const success = searchParams.get('success')
  const error = searchParams.get('error')

  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'password', label: 'Password' },
    { id: 'integrations', label: 'Integrations' },
    ...(user?.role === 'admin' ? [{ id: 'accounts', label: 'Accounts' }] : []),
    { id: 'about', label: 'About' },
  ]
  const [activeTab, setActiveTab] = useState('profile')

  const [profile, setProfile] = useState({ name: user?.name || '', email: user?.email || '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')

  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState('')

  const [employees, setEmployees] = useState([])
  const [clients, setClients] = useState([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [empForm, setEmpForm] = useState({ name: '', email: '', role: 'rep' })
  const [empSaving, setEmpSaving] = useState(false)
  const [empMsg, setEmpMsg] = useState('')
  const [tempPassword, setTempPassword] = useState(null)
  const [guestForm, setGuestForm] = useState({ name: '', email: '' })
  const [guestSaving, setGuestSaving] = useState(false)
  const [guestMsg, setGuestMsg] = useState('')

  useEffect(() => {
    if (success || error) {
      setTimeout(() => window.history.replaceState({}, document.title, '/settings'), 3000)
    }
  }, [success, error])

  useEffect(() => {
    if (activeTab === 'accounts' && user?.role === 'admin') loadAccounts()
  }, [activeTab])

  const loadAccounts = async () => {
    setAccountsLoading(true)
    try {
      const [empRes, clientRes] = await Promise.all([
        axios.get('/api/users', headers),
        axios.get('/api/users/clients', headers),
      ])
      setEmployees(empRes.data)
      setClients(clientRes.data)
    } catch (err) {
      console.error('Failed to load accounts', err)
    } finally {
      setAccountsLoading(false)
    }
  }

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

  const handleInviteEmployee = async (e) => {
    e.preventDefault()
    setEmpMsg('')
    setTempPassword(null)
    setEmpSaving(true)
    try {
      const res = await axios.post('/api/users/invite', empForm, headers)
      setTempPassword(res.data.tempPassword)
      setEmpForm({ name: '', email: '', role: 'rep' })
      setEmployees(prev => [...prev, res.data.user])
    } catch (err) {
      setEmpMsg(err.response?.data?.error || 'Failed to invite employee.')
    } finally {
      setEmpSaving(false)
    }
  }

  const handleInviteGuest = async (e) => {
    e.preventDefault()
    setGuestMsg('')
    setGuestSaving(true)
    try {
      await axios.post('/api/auth/client/invite', guestForm, headers)
      setGuestMsg(`Invitation sent to ${guestForm.email}`)
      setGuestForm({ name: '', email: '' })
    } catch (err) {
      setGuestMsg(err.response?.data?.error || 'Failed to send invitation.')
    } finally {
      setGuestSaving(false)
    }
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal'
  const btnCls = 'px-4 py-2 bg-teal text-white text-sm font-medium rounded-lg hover:bg-teal/90 disabled:opacity-50 transition-colors'

  return (
    <div className="p-8">
      <h2 className="font-syne text-2xl font-bold text-navy mb-6">Settings</h2>

      {success && (
        <div className="mb-6 px-4 py-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          {decodeURIComponent(success)}
        </div>
      )}
      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {decodeURIComponent(error)}
        </div>
      )}

      <div className="flex gap-1 mb-8 border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-teal text-teal'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="max-w-2xl">

        {activeTab === 'profile' && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            {profileMsg && (
              <p className={`text-sm mb-4 ${profileMsg === 'Profile updated.' ? 'text-green-600' : 'text-red-500'}`}>{profileMsg}</p>
            )}
            <form onSubmit={handleProfileSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input type="text" value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} required className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} required className={inputCls} />
              </div>
              <button type="submit" disabled={profileSaving} className={btnCls}>
                {profileSaving ? 'Saving...' : 'Save Profile'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'password' && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            {pwMsg && (
              <p className={`text-sm mb-4 ${pwMsg === 'Password updated.' ? 'text-green-600' : 'text-red-500'}`}>{pwMsg}</p>
            )}
            <form onSubmit={handlePasswordSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Current Password</label>
                <input type="password" value={passwords.current_password} onChange={e => setPasswords({ ...passwords, current_password: e.target.value })} required className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
                <input type="password" value={passwords.new_password} onChange={e => setPasswords({ ...passwords, new_password: e.target.value })} required minLength={8} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Confirm New Password</label>
                <input type="password" value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} required className={inputCls} />
              </div>
              <button type="submit" disabled={pwSaving} className={btnCls}>
                {pwSaving ? 'Saving...' : 'Change Password'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'integrations' && <GmailConnect />}

        {activeTab === 'accounts' && (
          <div className="space-y-10">

            {/* Employees */}
            <div>
              <h3 className="font-syne text-lg font-semibold text-navy mb-4">Employees</h3>
              <div className="bg-white rounded-xl shadow-sm p-6 mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Add Employee</p>
                {empMsg && <p className="text-sm mb-3 text-red-500">{empMsg}</p>}
                {tempPassword && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs font-semibold text-amber-800 mb-1">Account created — share this temporary password:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-amber-900 bg-amber-100 px-2 py-1 rounded">{tempPassword}</code>
                      <button onClick={() => navigator.clipboard.writeText(tempPassword)} className="text-xs text-amber-700 hover:text-amber-900 underline">Copy</button>
                    </div>
                    <p className="text-xs text-amber-600 mt-1">They can change it in Settings after logging in.</p>
                  </div>
                )}
                <form onSubmit={handleInviteEmployee} className="flex gap-3 flex-wrap">
                  <input type="text" placeholder="Name" value={empForm.name} onChange={e => setEmpForm({ ...empForm, name: e.target.value })} required className="flex-1 min-w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
                  <input type="email" placeholder="Email" value={empForm.email} onChange={e => setEmpForm({ ...empForm, email: e.target.value })} required className="flex-1 min-w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
                  <select value={empForm.role} onChange={e => setEmpForm({ ...empForm, role: e.target.value })} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal">
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <button type="submit" disabled={empSaving} className={btnCls}>
                    {empSaving ? 'Adding...' : 'Add Employee'}
                  </button>
                </form>
              </div>
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                {accountsLoading ? (
                  <p className="px-4 py-6 text-sm text-gray-400">Loading...</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['Name', 'Email', 'Role', 'Status'].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {employees.length === 0 ? (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No employees yet</td></tr>
                      ) : employees.map(emp => (
                        <tr key={emp.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-800">{emp.name}</td>
                          <td className="px-4 py-3 text-gray-500">{emp.email}</td>
                          <td className="px-4 py-3 text-gray-600">{ROLE_LABELS[emp.role] || emp.role}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${emp.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {emp.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Guest Accounts */}
            <div>
              <h3 className="font-syne text-lg font-semibold text-navy mb-4">Guest Accounts</h3>
              <div className="bg-white rounded-xl shadow-sm p-6 mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Invite Guest</p>
                {guestMsg && (
                  <p className={`text-sm mb-3 ${guestMsg.startsWith('Invitation') ? 'text-green-600' : 'text-red-500'}`}>{guestMsg}</p>
                )}
                <form onSubmit={handleInviteGuest} className="flex gap-3 flex-wrap">
                  <input type="text" placeholder="Name" value={guestForm.name} onChange={e => setGuestForm({ ...guestForm, name: e.target.value })} required className="flex-1 min-w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
                  <input type="email" placeholder="Email" value={guestForm.email} onChange={e => setGuestForm({ ...guestForm, email: e.target.value })} required className="flex-1 min-w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal" />
                  <button type="submit" disabled={guestSaving} className={btnCls}>
                    {guestSaving ? 'Sending...' : 'Send Invite'}
                  </button>
                </form>
              </div>
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                {accountsLoading ? (
                  <p className="px-4 py-6 text-sm text-gray-400">Loading...</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['Name', 'Email', 'Status', 'Last Login'].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {clients.length === 0 ? (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No guest accounts yet</td></tr>
                      ) : clients.map(client => (
                        <tr key={client.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-800">{client.name || '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{client.email}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${client.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {client.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {client.last_login_at ? new Date(client.last_login_at).toLocaleDateString() : 'Never'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

          </div>
        )}

        {activeTab === 'about' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <p className="text-sm text-brand-gray mb-2"><strong>ResiQ CRM</strong> v0.1.0</p>
            <p className="text-xs text-gray-500">A lightweight CRM for property tech professionals. All data is stored securely and encrypted.</p>
          </div>
        )}

      </div>
    </div>
  )
}
