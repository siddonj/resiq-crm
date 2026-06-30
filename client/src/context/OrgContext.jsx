import { createContext, useContext } from 'react'
import { useParams, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/api'

const OrgContext = createContext(null)

// Only one OrgShell should be active at a time — this module-level ref
// is read by the axios interceptor outside of React's render cycle.
let _activeOrgSlug = null
export const getActiveOrgSlug = () => _activeOrgSlug

export function OrgShell() {
  const { orgSlug } = useParams()
  // Intentional: update module-level ref synchronously so the axios interceptor
  // reads the correct slug before the first API call fires this render cycle.
  _activeOrgSlug = orgSlug

  const { data: org, isLoading, isError } = useQuery({
    queryKey: ['org', orgSlug],
    queryFn: () => api.get(`/orgs/${orgSlug}`).then((r) => r.data.data),
    staleTime: 5 * 60 * 1000, // 5 minutes — matches Redis TTL
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Loading workspace…
      </div>
    )
  }

  if (isError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Failed to load workspace
      </div>
    )
  }

  if (!org) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Organization not found
      </div>
    )
  }

  return (
    <OrgContext.Provider value={org}>
      <Outlet />
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
