import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

export default function PortfolioDetail() {
  const { portfolioId } = useParams()
  const navigate = useNavigate()
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [portfolio, setPortfolio] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [workload, setWorkload] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadData = async () => {
    setLoading(true)
    try {
      const [{ data: dashData }, { data: wlData }] = await Promise.all([
        axios.get(`/api/portfolios/${portfolioId}/dashboard`, headers),
        axios.get(`/api/portfolios/${portfolioId}/workload`, headers).catch(() => ({ data: [] })),
      ])
      setPortfolio(dashData.portfolio)
      setDashboard(dashData)
      setWorkload(wlData)
      setError('')
    } catch (err) {
      setError('Failed to load portfolio')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token && portfolioId) loadData()
  }, [token, portfolioId])

  if (loading) return <div className="p-6 text-sm text-gray-600">Loading portfolio…</div>
  if (!portfolio) return <div className="p-6 text-sm text-red-600">{error || 'Portfolio not found'}</div>

  const kpi = dashboard?.kpi || {}
  const health = dashboard?.health || []
  const milestones = dashboard?.milestones || []

  // Aggregate workload by user
  const workloadByUser = {}
  for (const row of workload) {
    if (!workloadByUser[row.user_id]) {
      workloadByUser[row.user_id] = { user_name: row.user_name, email: row.email, projects: [] }
    }
    workloadByUser[row.user_id].projects.push(row)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => navigate('/portfolios')} className="text-xs text-gray-500 hover:text-gray-700 mb-1">← Back to Portfolios</button>
          <h1 className="text-2xl font-bold text-gray-900">{portfolio.name}</h1>
          {portfolio.description && <p className="text-sm text-gray-500 mt-1">{portfolio.description}</p>}
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Tasks" value={kpi.total_tasks || 0} />
        <KpiCard label="Completed" value={`${kpi.completion_pct || 0}%`} />
        <KpiCard label="Est. Hours" value={Math.round(kpi.total_estimated_hours || 0)} />
        <KpiCard label="Spent Hours" value={Math.round(kpi.total_spent_hours || 0)} />
      </div>

      {/* Projects Health */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Projects</h3>
        {health.length === 0 ? (
          <div className="text-sm text-gray-500">No projects in this portfolio.</div>
        ) : (
          <div className="space-y-2">
            {health.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 cursor-pointer"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <div className={`w-2.5 h-2.5 rounded-full ${
                  p.health_status === 'green' ? 'bg-green-500' :
                  p.health_status === 'amber' ? 'bg-amber-500' : 'bg-red-500'
                }`} />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{p.name}</div>
                  <div className="text-[10px] text-gray-500">{p.total_tasks} tasks · {p.completed_tasks} done</div>
                </div>
                <div className="w-24">
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        p.completion_pct >= 70 ? 'bg-green-500' :
                        p.completion_pct >= 30 ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${p.completion_pct}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-500 text-right mt-0.5">{p.completion_pct}%</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Milestones</h3>
          <div className="space-y-2">
            {milestones.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-sm">
                <span className={`w-2 h-2 rounded-full ${
                  m.status === 'Done' ? 'bg-green-500' :
                  m.status === 'In Progress' ? 'bg-blue-500' : 'bg-gray-300'
                }`} />
                <span className="flex-1 text-gray-900">{m.name}</span>
                <span className="text-xs text-gray-500">{m.project_name}</span>
                {m.due_date && (
                  <span className="text-xs text-gray-500">{new Date(m.due_date).toLocaleDateString()}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Workload Heatmap */}
      {Object.keys(workloadByUser).length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Resource Allocation</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Member</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Project</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Tasks</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Est. Hours</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Spent Hours</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(workloadByUser).map((user) =>
                  user.projects.map((proj, idx) => (
                    <tr key={`${user.user_name}-${proj.project_id}`} className="border-b">
                      {idx === 0 && (
                        <td className="px-3 py-2 font-medium text-gray-900" rowSpan={user.projects.length}>
                          {user.user_name || user.email}
                        </td>
                      )}
                      <td className="px-3 py-2 text-gray-700">{proj.project_name}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{proj.task_count}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{Math.round(proj.estimated_hours)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{Math.round(proj.spent_hours)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  )
}
