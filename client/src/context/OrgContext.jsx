import { createContext, useContext } from 'react'
import { useParams, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/api'

const OrgContext = createContext(null)

// Module-level slug ref consumed by the axios interceptor.
// Updated synchronously whenever OrgShell renders.
let _activeOrgSlug = null
export const getActiveOrgSlug = () => _activeOrgSlug

export function OrgShell() {
  const { orgSlug } = useParams()
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

  if (isError || !org) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Organization not found.
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
