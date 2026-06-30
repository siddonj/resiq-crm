// client/src/pages/OrgRedirect.jsx
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../api/api'
import OrgPicker from '../components/OrgPicker'

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      Loading…
    </div>
  )
}

export default function OrgRedirect() {
  const { data: orgs, isLoading } = useQuery({
    queryKey: ['my-orgs'],
    queryFn: () => api.get('/orgs/mine').then((r) => r.data.data),
  })

  if (isLoading) return <Spinner />
  if (!orgs || orgs.length === 0) return <div>No organizations found. Contact your admin.</div>
  if (orgs.length === 1) return <Navigate to={`/org/${orgs[0].slug}`} replace />
  return <OrgPicker orgs={orgs} />
}
