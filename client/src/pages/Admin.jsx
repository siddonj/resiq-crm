import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import api from '../api/api'

export default function Admin() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [newOrg, setNewOrg] = useState({ name: '', slug: '' })
  const [createError, setCreateError] = useState(null)
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' })
  const [inviteError, setInviteError] = useState(null)

  // Guard: only super-admins
  if (!user?.is_super_admin) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1>Access Denied</h1>
        <p>Super-admin access required.</p>
      </div>
    )
  }

  // --- Orgs ---
  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => api.get('/orgs').then((r) => r.data.data),
  })

  const createOrgMutation = useMutation({
    mutationFn: (payload) => api.post('/orgs', payload).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orgs'] })
      setNewOrg({ name: '', slug: '' })
      setCreateError(null)
    },
    onError: (err) => setCreateError(err.response?.data?.error || err.message),
  })

  const handleCreate = (e) => {
    e.preventDefault()
    if (!newOrg.name) return
    const payload = newOrg.slug ? newOrg : { name: newOrg.name }
    createOrgMutation.mutate(payload)
  }

  // --- Members ---
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['admin-members', selectedOrg?.slug],
    queryFn: () =>
      api.get(`/org/${selectedOrg.slug}/members`).then((r) => r.data.data),
    enabled: !!selectedOrg,
  })

  const removeMemberMutation = useMutation({
    mutationFn: (userId) =>
      api.delete(`/org/${selectedOrg.slug}/members/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-members', selectedOrg?.slug] })
      queryClient.invalidateQueries({ queryKey: ['admin-orgs'] })
    },
  })

  const inviteMutation = useMutation({
    mutationFn: (payload) =>
      api.post(`/org/${selectedOrg.slug}/members/invite`, payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-members', selectedOrg?.slug] })
      setInviteForm({ email: '', role: 'member' })
      setInviteError(null)
    },
    onError: (err) => setInviteError(err.response?.data?.error || err.message),
  })

  const handleInvite = (e) => {
    e.preventDefault()
    if (!inviteForm.email) return
    inviteMutation.mutate(inviteForm)
  }

  // --- Styles ---
  const card = {
    marginBottom: '2rem',
    padding: '1.5rem',
    background: '#f9fafb',
    borderRadius: '0.75rem',
    border: '1px solid #e5e7eb',
  }
  const th = { padding: '0.5rem 1rem', textAlign: 'left', fontWeight: 600, color: '#374151' }
  const td = { padding: '0.75rem 1rem', borderBottom: '1px solid #f3f4f6' }
  const input = {
    flex: 1,
    minWidth: '160px',
    padding: '0.5rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '0.5rem',
    fontSize: '0.95rem',
  }
  const primaryBtn = {
    padding: '0.5rem 1.25rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    fontSize: '0.9rem',
  }
  const dangerBtn = {
    padding: '0.25rem 0.6rem',
    background: '#fee2e2',
    color: '#dc2626',
    border: '1px solid #fca5a5',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    fontSize: '0.82rem',
  }
  const ghostBtn = {
    padding: '0.25rem 0.75rem',
    background: '#eff6ff',
    color: '#2563eb',
    border: '1px solid #bfdbfe',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
  }

  return (
    <div style={{ maxWidth: '960px', margin: '2rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '2rem' }}>
        Super-Admin Panel
      </h1>

      {/* Create org */}
      <section style={card}>
        <h2 style={{ fontWeight: 600, marginBottom: '1rem' }}>Create Organization</h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input
            placeholder="Name *"
            value={newOrg.name}
            onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
            required
            style={input}
          />
          <input
            placeholder="Slug (optional — auto-generated)"
            value={newOrg.slug}
            onChange={(e) => setNewOrg({ ...newOrg, slug: e.target.value })}
            style={{ ...input, minWidth: '220px' }}
          />
          <button type="submit" disabled={createOrgMutation.isPending} style={primaryBtn}>
            {createOrgMutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </form>
        {createError && (
          <p style={{ color: '#dc2626', marginTop: '0.5rem', fontSize: '0.9rem' }}>{createError}</p>
        )}
      </section>

      {/* Orgs table */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontWeight: 600, marginBottom: '1rem' }}>
          Organizations {orgs ? `(${orgs.length})` : ''}
        </h2>
        {orgsLoading ? (
          <p style={{ color: '#6b7280' }}>Loading…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '0.75rem', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <thead style={{ background: '#f3f4f6' }}>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Slug</th>
                <th style={th}>Members</th>
                <th style={th}>Created</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(orgs || []).map((org) => (
                <tr
                  key={org.id}
                  style={{ background: selectedOrg?.id === org.id ? '#eff6ff' : 'transparent' }}
                >
                  <td style={{ ...td, fontWeight: 500 }}>{org.name}</td>
                  <td style={{ ...td, color: '#6b7280', fontFamily: 'monospace', fontSize: '0.88rem' }}>
                    {org.slug}
                  </td>
                  <td style={td}>{org.member_count ?? '—'}</td>
                  <td style={{ ...td, color: '#6b7280', fontSize: '0.88rem' }}>
                    {org.created_at ? new Date(org.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() =>
                          setSelectedOrg(selectedOrg?.id === org.id ? null : org)
                        }
                        style={ghostBtn}
                      >
                        {selectedOrg?.id === org.id ? 'Close' : 'Manage'}
                      </button>
                      <button
                        onClick={() => navigate(`/org/${org.slug}`)}
                        style={ghostBtn}
                      >
                        Open →
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Members panel */}
      {selectedOrg && (
        <section style={card}>
          <h2 style={{ fontWeight: 600, marginBottom: '1.25rem' }}>
            Members — <span style={{ fontFamily: 'monospace', fontSize: '0.95rem' }}>{selectedOrg.name}</span>
          </h2>

          {/* Invite form */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontWeight: 500, marginBottom: '0.75rem', fontSize: '0.95rem', color: '#374151' }}>
              Invite Member
            </h3>
            <form onSubmit={handleInvite} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <input
                type="email"
                placeholder="Email *"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                required
                style={input}
              />
              <select
                value={inviteForm.role}
                onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                style={{ ...input, minWidth: '120px', flex: 'none' }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
              <button type="submit" disabled={inviteMutation.isPending} style={primaryBtn}>
                {inviteMutation.isPending ? 'Sending…' : 'Invite'}
              </button>
            </form>
            {inviteError && (
              <p style={{ color: '#dc2626', marginTop: '0.5rem', fontSize: '0.9rem' }}>{inviteError}</p>
            )}
            {inviteMutation.isSuccess && (
              <p style={{ color: '#16a34a', marginTop: '0.5rem', fontSize: '0.9rem' }}>Invitation sent.</p>
            )}
          </div>

          {/* Members list */}
          {membersLoading ? (
            <p style={{ color: '#6b7280' }}>Loading members…</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={th}>Email</th>
                  <th style={th}>Name</th>
                  <th style={th}>Role</th>
                  <th style={th}>Joined</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {(members || []).map((m) => (
                  <tr key={m.user_id ?? m.id}>
                    <td style={td}>{m.email}</td>
                    <td style={td}>{m.full_name ?? m.name ?? '—'}</td>
                    <td style={{ ...td, color: '#6b7280', fontSize: '0.88rem' }}>{m.role}</td>
                    <td style={{ ...td, color: '#6b7280', fontSize: '0.88rem' }}>
                      {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={td}>
                      <button
                        onClick={() => {
                          if (window.confirm(`Remove ${m.email} from ${selectedOrg.name}?`)) {
                            removeMemberMutation.mutate(m.user_id ?? m.id)
                          }
                        }}
                        disabled={removeMemberMutation.isPending}
                        style={dangerBtn}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {(members || []).length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ ...td, color: '#9ca3af', textAlign: 'center' }}>
                      No members found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}
