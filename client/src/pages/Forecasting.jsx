import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import DashboardCard from '../components/dashboard/DashboardCard'

const STAGES = [
  { key: 'lead', label: 'Lead' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'active', label: 'Active' },
  { key: 'closed_won', label: 'Closed Won' },
  { key: 'closed_lost', label: 'Closed Lost' },
]

const STAGE_COLORS = {
  lead: '#3B82F6',
  qualified: '#8B5CF6',
  proposal: '#F59E0B',
  active: '#10B981',
  closed_won: '#22C55E',
  closed_lost: '#EF4444',
}

function formatCurrency(val) {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}k`
  return `$${val.toFixed(0)}`
}

function formatMonth(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

export default function Forecasting() {
  const { token } = useAuth()
  const [forecast, setForecast] = useState(null)
  const [stageProbs, setStageProbs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingProbs, setEditingProbs] = useState(false)
  const [probEdits, setProbEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('pipeline') // 'pipeline' | 'forecast' | 'settings'

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } }

  useEffect(() => {
    fetchData()
  }, [token])

  const fetchData = async () => {
    try {
      const [forecastRes, probsRes] = await Promise.all([
        axios.get('/api/analytics/deals/forecast', authHeaders),
        axios.get('/api/analytics/deals/stage-probabilities', authHeaders),
      ])
      setForecast(forecastRes.data)
      setStageProbs(probsRes.data)
    } catch (err) {
      console.error('Error fetching forecast data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleEditProbs = () => {
    const edits = {}
    stageProbs.stages.forEach(s => { edits[s.stage] = s.user_probability })
    setProbEdits(edits)
    setEditingProbs(true)
  }

  const handleSaveProbs = async () => {
    setSaving(true)
    try {
      const probabilities = Object.entries(probEdits).map(([stage, probability]) => ({
        stage, probability: parseFloat(probability),
      }))
      await axios.put('/api/analytics/deals/stage-probabilities', { probabilities }, authHeaders)
      await fetchData()
      setEditingProbs(false)
    } catch (err) {
      console.error('Error saving probabilities:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleUseAI = () => {
    const edits = {}
    stageProbs.stages.forEach(s => { edits[s.stage] = s.ai_probability })
    setProbEdits(edits)
  }

  if (loading) return <div className="p-8 text-sm text-brand-gray">Loading forecast data...</div>
  if (!forecast) return <div className="p-8 text-sm text-brand-gray">No data available</div>

  // Build combined monthly chart data
  const allMonths = new Set()
  forecast.monthly_actual.forEach(r => allMonths.add(r.month))
  forecast.monthly_forecast.forEach(r => allMonths.add(r.month))
  const sortedMonths = Array.from(allMonths).sort()
  const chartData = sortedMonths.map(month => ({
    month,
    actual: forecast.monthly_actual.find(r => r.month === month)?.actual_revenue || 0,
    forecast: forecast.monthly_forecast.find(r => r.month === month)?.weighted_value || 0,
  }))
  const maxChartVal = Math.max(...chartData.map(d => Math.max(d.actual, d.forecast)), 1)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-syne text-2xl font-bold text-navy">Deal Forecasting</h2>
          <p className="text-xs text-brand-gray mt-0.5">Win probability &amp; revenue pipeline forecast</p>
        </div>
        <div className="flex gap-2">
          {['pipeline', 'forecast', 'settings'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-sm font-medium px-4 py-2 rounded-lg capitalize transition-colors ${
                activeTab === tab ? 'bg-teal text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab === 'pipeline' ? 'Weighted Pipeline' : tab === 'forecast' ? 'Monthly Forecast' : 'Stage Settings'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <DashboardCard
          title="Weighted Pipeline"
          value={formatCurrency(forecast.total_weighted_pipeline)}
          subtitle="probability-adjusted value"
          icon="⚖️"
          color="teal"
        />
        <DashboardCard
          title="Active Opportunities"
          value={forecast.opportunities.length}
          subtitle="with probability scores"
          icon="🎯"
          color="blue"
        />
        <DashboardCard
          title="Overall Win Rate"
          value={stageProbs?.overall_win_rate != null ? `${stageProbs.overall_win_rate.toFixed(0)}%` : 'N/A'}
          subtitle={`${stageProbs?.total_closed || 0} closed deals`}
          icon="🏆"
          color="emerald"
        />
        <DashboardCard
          title="Top Opportunity"
          value={forecast.opportunities[0] ? formatCurrency(forecast.opportunities[0].weighted_value) : '$0'}
          subtitle={forecast.opportunities[0]?.title || 'No active deals'}
          icon="⭐"
          color="amber"
        />
      </div>

      {/* Weighted Pipeline Tab */}
      {activeTab === 'pipeline' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-semibold text-navy mb-4">Opportunity Scoring</h3>
            {forecast.opportunities.length === 0 ? (
              <p className="text-sm text-brand-gray text-center py-8">No active deals. Add deals with values to see opportunity scoring.</p>
            ) : (
              <div className="space-y-3">
                {forecast.opportunities.map((opp, idx) => (
                  <div key={opp.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: STAGE_COLORS[opp.stage] || '#6B7280' }}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-navy truncate">{opp.title}</p>
                        {opp.contact_name && (
                          <span className="text-xs text-brand-gray shrink-0">· {opp.contact_name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${opp.score}%`, backgroundColor: STAGE_COLORS[opp.stage] || '#6B7280' }}
                          />
                        </div>
                        <span className="text-xs text-brand-gray whitespace-nowrap">score: {opp.score}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-navy">{formatCurrency(opp.value)}</p>
                      <p className="text-xs text-brand-gray">{opp.probability}% → {formatCurrency(opp.weighted_value)}</p>
                    </div>
                    <div className="shrink-0">
                      <span
                        className="text-xs px-2 py-1 rounded-full font-medium capitalize"
                        style={{ backgroundColor: `${STAGE_COLORS[opp.stage]}20`, color: STAGE_COLORS[opp.stage] }}
                      >
                        {opp.stage.replace('_', ' ')}
                      </span>
                    </div>
                    {opp.close_date && (
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-brand-gray">Close</p>
                        <p className="text-xs font-medium text-navy">{new Date(opp.close_date).toLocaleDateString()}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Monthly Forecast Tab */}
      {activeTab === 'forecast' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-navy">Monthly Forecast vs Actual</h3>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-teal inline-block" />
                  Actual Revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-blue-400 inline-block" />
                  Weighted Forecast
                </span>
              </div>
            </div>
            {chartData.length === 0 ? (
              <div className="py-12 text-center text-sm text-brand-gray">
                No forecast data yet. Close deals or set close dates on active deals to see monthly projections.
              </div>
            ) : (
              <div className="relative">
                <div className="flex items-end gap-2 h-48">
                  {chartData.map((d, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex items-end gap-0.5 h-40">
                        <div
                          className="flex-1 bg-teal rounded-t transition-all"
                          style={{ height: `${(d.actual / maxChartVal) * 100}%`, minHeight: d.actual > 0 ? 4 : 0 }}
                          title={`Actual: ${formatCurrency(d.actual)}`}
                        />
                        <div
                          className="flex-1 bg-blue-400 rounded-t transition-all"
                          style={{ height: `${(d.forecast / maxChartVal) * 100}%`, minHeight: d.forecast > 0 ? 4 : 0 }}
                          title={`Forecast: ${formatCurrency(d.forecast)}`}
                        />
                      </div>
                      <p className="text-xs text-brand-gray whitespace-nowrap">{formatMonth(d.month)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Forecast accuracy note */}
          {stageProbs?.total_closed >= 5 && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">🤖</span>
                <div>
                  <p className="text-sm font-medium text-emerald-800">AI-adjusted probabilities active</p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    Based on your {stageProbs.total_closed} closed deals, your overall win rate is{' '}
                    <strong>{stageProbs.overall_win_rate?.toFixed(0)}%</strong>. Stage probabilities have been
                    scaled to reflect your actual performance.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stage Settings Tab */}
      {activeTab === 'settings' && stageProbs && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-navy">Stage Win Probabilities</h3>
              <p className="text-xs text-brand-gray mt-0.5">
                Set the default win probability (%) for each deal stage. Used to calculate weighted pipeline value.
              </p>
            </div>
            <div className="flex gap-2">
              {editingProbs ? (
                <>
                  <button
                    onClick={handleUseAI}
                    className="text-xs border border-teal text-teal px-3 py-1.5 rounded-lg hover:bg-teal/5 transition-colors"
                  >
                    🤖 Use AI
                  </button>
                  <button
                    onClick={() => setEditingProbs(false)}
                    className="text-xs border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveProbs}
                    disabled={saving}
                    className="text-xs bg-teal text-white px-3 py-1.5 rounded-lg hover:bg-teal/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleEditProbs}
                  className="text-xs bg-teal text-white px-3 py-1.5 rounded-lg hover:bg-teal/90 transition-colors"
                >
                  Edit Probabilities
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {stageProbs.stages.map(s => (
              <div key={s.stage} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                <div
                  className="w-2 h-8 rounded-full flex-shrink-0"
                  style={{ backgroundColor: STAGE_COLORS[s.stage] || '#6B7280' }}
                />
                <div className="w-28 flex-shrink-0">
                  <p className="text-sm font-medium text-navy capitalize">{s.stage.replace('_', ' ')}</p>
                  <p className="text-xs text-brand-gray">AI: {s.ai_probability}%</p>
                </div>
                <div className="flex-1">
                  {editingProbs ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={probEdits[s.stage] ?? s.user_probability}
                        onChange={e => setProbEdits(prev => ({ ...prev, [s.stage]: parseInt(e.target.value) }))}
                        className="flex-1 accent-teal"
                      />
                      <span className="text-sm font-bold text-navy w-12 text-right">
                        {probEdits[s.stage] ?? s.user_probability}%
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${s.user_probability}%`,
                            backgroundColor: STAGE_COLORS[s.stage] || '#6B7280',
                          }}
                        />
                      </div>
                      <span className="text-sm font-bold text-navy w-12 text-right">{s.user_probability}%</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {stageProbs.total_closed < 5 && (
            <p className="text-xs text-brand-gray mt-4 text-center">
              Close at least 5 deals to enable AI-based probability recommendations.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
