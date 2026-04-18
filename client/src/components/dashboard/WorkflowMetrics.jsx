import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'
import DashboardCard from './DashboardCard'

export default function WorkflowMetrics() {
  const { token } = useAuth()
  const [summary, setSummary] = useState(null)
  const [topWorkflows, setTopWorkflows] = useState(null)
  const [loading, setLoading] = useState(true)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    fetchData()
  }, [token])

  const fetchData = async () => {
    try {
      const [summaryRes, topRes] = await Promise.all([
        axios.get('/api/analytics/workflows/summary', authHeaders),
        axios.get('/api/analytics/workflows/top', authHeaders),
      ])
      setSummary(summaryRes.data)
      setTopWorkflows(topRes.data)
    } catch (err) {
      console.error('Error fetching workflow metrics:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="text-sm text-brand-gray">Loading...</div>
  if (!summary) return <div className="text-sm text-brand-gray">No workflows yet</div>

  const { executions_this_month, workflows } = summary

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-navy">Workflow Automation</h3>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DashboardCard
          title="Workflows"
          value={workflows.total}
          subtitle={`${workflows.enabled} enabled`}
          icon="⚡"
          color="teal"
        />
        <DashboardCard
          title="Executions (Month)"
          value={executions_this_month.total}
          subtitle={`this month`}
          icon="🔄"
          color="blue"
        />
        <DashboardCard
          title="Success Rate"
          value={`${executions_this_month.success_rate}%`}
          subtitle={`${executions_this_month.completed}/${executions_this_month.completed + executions_this_month.failed}`}
          icon="✅"
          color="emerald"
        />
        <DashboardCard
          title="Failed"
          value={executions_this_month.failed}
          subtitle={`this month`}
          icon="❌"
          color={executions_this_month.failed > 0 ? 'rose' : 'gray'}
        />
      </div>

      {/* Top Workflows */}
      {topWorkflows && topWorkflows.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-xs font-semibold text-navy mb-3">Most Active Workflows</p>
          <div className="space-y-3">
            {topWorkflows.map((wf, idx) => (
              <div key={idx} className="p-3 bg-white rounded border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-navy">{wf.workflow_name}</p>
                  <span className="text-xs font-semibold text-teal">{wf.execution_count} runs</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${wf.success_rate}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-navy whitespace-nowrap">{wf.success_rate.toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
