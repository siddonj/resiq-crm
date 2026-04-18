import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'
import DashboardCard from './DashboardCard'

export default function PipelineSummary() {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [byStage, setByStage] = useState(null)
  const [loading, setLoading] = useState(true)

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    fetchData()
  }, [token])

  const fetchData = async () => {
    try {
      const [summaryRes, stageRes] = await Promise.all([
        axios.get('/api/analytics/deals/summary', authHeaders),
        axios.get('/api/analytics/deals/by-stage', authHeaders),
      ])
      setData(summaryRes.data)
      setByStage(stageRes.data)
    } catch (err) {
      console.error('Error fetching pipeline summary:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="text-sm text-brand-gray">Loading...</div>
  if (!data) return <div className="text-sm text-brand-gray">No data</div>

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-navy">Sales Pipeline</h3>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DashboardCard
          title="Active Deals"
          value={data.active_count}
          subtitle={`$${(data.pipeline_value / 1000).toFixed(0)}k pipeline`}
          icon="🔄"
          color="blue"
        />
        <DashboardCard
          title="Pipeline Value"
          value={`$${(data.pipeline_value / 1000).toFixed(0)}k`}
          subtitle={`Avg: $${(data.avg_active_value / 1000).toFixed(0)}k`}
          icon="💰"
          color="emerald"
        />
        <DashboardCard
          title="Closed Won"
          value={data.closed_won}
          subtitle={`$${(data.closed_won_value / 1000).toFixed(0)}k revenue`}
          icon="🏆"
          color="amber"
        />
        <DashboardCard
          title="Win Rate"
          value={`${data.win_rate}%`}
          subtitle={`${data.closed_won}W / ${data.closed_lost}L`}
          icon="📊"
          color="rose"
        />
      </div>

      {/* Deal Stage Breakdown */}
      {byStage && byStage.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-xs font-semibold text-navy mb-3">Deals by Stage</p>
          <div className="space-y-3">
            {byStage.map((stage, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <span className="text-xs font-medium text-navy capitalize">{stage.stage}</span>
                <div className="flex items-center gap-3 flex-1 ml-4">
                  <div className="flex-1 h-2 bg-white rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(stage.count / Math.max(...byStage.map(s => s.count))) * 100}%`,
                        backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'][idx],
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium text-navy w-12 text-right">{stage.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
