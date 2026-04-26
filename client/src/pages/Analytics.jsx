import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import DashboardCard from '../components/dashboard/DashboardCard'

const STAGE_COLORS = {
  lead: '#3B82F6',
  qualified: '#8B5CF6',
  proposal: '#F59E0B',
  active: '#10B981',
  closed_won: '#22C55E',
  closed_lost: '#EF4444',
}

const STAGE_ORDER = ['lead', 'qualified', 'proposal', 'active', 'closed_won', 'closed_lost']

function formatCurrency(val) {
  if (val == null) return 'N/A'
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}k`
  return `$${Number(val).toFixed(0)}`
}

function formatMonth(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

function formatServiceLine(value) {
  if (!value || value === 'unspecified') return 'Unspecified'
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── simple bar rendered with divs ───────────────────────────────────────────
function MiniBar({ pct, color }) {
  return (
    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }}
      />
    </div>
  )
}

// ── CSV export helper ────────────────────────────────────────────────────────
function exportCSV(rows, filename) {
  if (!rows || rows.length === 0) return
  const headers = Object.keys(rows[0])
  const csvContent = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h]
        if (v == null) return ''
        const str = String(v)
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str
      }).join(',')
    ),
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Tab components ──────────────────────────────────────────────────────────

function OverviewTab({ winLoss, velocity, mrr, serviceLines }) {
  const { overall } = winLoss || {}
  const maxMonthRev = mrr?.monthly?.length
    ? Math.max(...mrr.monthly.map(m => m.revenue), 1)
    : 1

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DashboardCard
          title="Overall Win Rate"
          value={overall?.win_rate != null ? `${overall.win_rate}%` : 'N/A'}
          subtitle={`${overall?.won || 0} won / ${overall?.lost || 0} lost`}
          icon="🏆"
          color="teal"
        />
        <DashboardCard
          title="YTD Revenue"
          value={formatCurrency(mrr?.ytd_revenue)}
          subtitle={`${mrr?.ytd_deals || 0} deals closed`}
          icon="💰"
          color="emerald"
        />
        <DashboardCard
          title="Avg Sales Cycle"
          value={velocity?.avg_sales_cycle_days != null ? `${velocity.avg_sales_cycle_days}d` : 'N/A'}
          subtitle="days to close a deal"
          icon="⏱️"
          color="blue"
        />
        <DashboardCard
          title="Avg Deal Size"
          value={serviceLines?.length
            ? formatCurrency(
                serviceLines.reduce((s, l) => s + parseFloat(l.avg_deal_size || 0), 0) /
                  serviceLines.length
              )
            : 'N/A'}
          subtitle="across all service lines"
          icon="📦"
          color="amber"
        />
      </div>

      {/* Revenue sparkline */}
      {mrr?.monthly?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-navy">Monthly Revenue (last 24 months)</h3>
            {mrr.mom_trend_pct != null && (
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                mrr.mom_trend_pct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}>
                {mrr.mom_trend_pct >= 0 ? '↑' : '↓'} {Math.abs(mrr.mom_trend_pct)}% MoM
              </span>
            )}
          </div>
          <div className="flex items-end gap-1 h-32">
            {mrr.monthly.map((m, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-teal rounded-t transition-all cursor-default"
                  style={{ height: `${(m.revenue / maxMonthRev) * 100}%`, minHeight: m.revenue > 0 ? 4 : 0 }}
                  title={`${formatMonth(m.month)}: ${formatCurrency(m.revenue)}`}
                />
                {mrr.monthly.length <= 12 && (
                  <p className="text-xs text-brand-gray whitespace-nowrap" style={{ fontSize: '9px' }}>
                    {formatMonth(m.month)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Win/Loss funnel overview */}
      {winLoss?.stage_funnel && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-navy mb-4">Deal Funnel Overview</h3>
          <div className="space-y-2">
            {STAGE_ORDER.map(stage => {
              const s = winLoss.stage_funnel.find(r => r.stage === stage)
              if (!s) return null
              const maxCount = Math.max(...winLoss.stage_funnel.map(r => r.count), 1)
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span
                    className="text-xs font-medium w-24 capitalize shrink-0"
                    style={{ color: STAGE_COLORS[stage] || '#6B7280' }}
                  >
                    {stage.replace('_', ' ')}
                  </span>
                  <MiniBar pct={(s.count / maxCount) * 100} color={STAGE_COLORS[stage] || '#6B7280'} />
                  <span className="text-xs text-navy font-semibold w-8 text-right">{s.count}</span>
                  <span className="text-xs text-brand-gray w-20 text-right">{formatCurrency(s.total_value)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function WinLossTab({ winLoss }) {
  if (!winLoss) return null
  const { overall, stage_funnel, by_service_line } = winLoss
  const activeStages = stage_funnel?.filter(s => !['closed_won', 'closed_lost'].includes(s.stage)) || []
  const maxActiveCount = Math.max(...(activeStages.map(s => s.count) || [1]), 1)

  const handleExport = () => {
    const rows = by_service_line?.map(r => ({
      service_line: r.service_line,
      total: r.total,
      won: r.won,
      lost: r.lost,
      win_rate_pct: r.win_rate ?? '',
    }))
    exportCSV(rows, 'win-loss-by-service-line.csv')
  }

  return (
    <div className="space-y-6">
      {/* Overall KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <DashboardCard
          title="Win Rate"
          value={overall?.win_rate != null ? `${overall.win_rate}%` : 'N/A'}
          subtitle={`${overall?.won || 0} won, ${overall?.lost || 0} lost`}
          icon="🏆"
          color="teal"
        />
        <DashboardCard
          title="Active Deals"
          value={overall?.active || 0}
          subtitle="in pipeline"
          icon="🔄"
          color="blue"
        />
        <DashboardCard
          title="Total Deals"
          value={overall?.total || 0}
          subtitle="all time"
          icon="📊"
          color="amber"
        />
      </div>

      {/* Stage funnel */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-sm font-semibold text-navy mb-4">Pipeline Funnel</h3>
        {activeStages.length === 0 ? (
          <p className="text-sm text-brand-gray text-center py-6">No active deals in pipeline.</p>
        ) : (
          <div className="space-y-3">
            {activeStages.map(s => (
              <div key={s.stage} className="flex items-center gap-3">
                <span
                  className="text-xs font-medium w-24 capitalize shrink-0"
                  style={{ color: STAGE_COLORS[s.stage] || '#6B7280' }}
                >
                  {s.stage.replace('_', ' ')}
                </span>
                <div className="flex-1 relative">
                  <div className="h-6 bg-gray-100 rounded-lg overflow-hidden">
                    <div
                      className="h-full rounded-lg flex items-center px-2 transition-all"
                      style={{
                        width: `${(s.count / maxActiveCount) * 100}%`,
                        backgroundColor: `${STAGE_COLORS[s.stage]}33`,
                        borderLeft: `3px solid ${STAGE_COLORS[s.stage]}`,
                        minWidth: s.count > 0 ? 48 : 0,
                      }}
                    >
                      <span className="text-xs font-bold" style={{ color: STAGE_COLORS[s.stage] }}>
                        {s.count}
                      </span>
                    </div>
                  </div>
                </div>
                <span className="text-xs text-brand-gray w-24 text-right">{formatCurrency(s.total_value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Win/Loss by service line */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-navy">Win/Loss by Service Line</h3>
          <button
            onClick={handleExport}
            className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            ↓ Export CSV
          </button>
        </div>
        {!by_service_line?.length ? (
          <p className="text-sm text-brand-gray text-center py-6">No data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left font-semibold text-brand-gray pb-2">Service Line</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Total</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Won</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Lost</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Win Rate</th>
                  <th className="pb-2 w-32" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {by_service_line.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="py-2 font-medium text-navy">{formatServiceLine(r.service_line)}</td>
                    <td className="py-2 text-right text-brand-gray">{r.total}</td>
                    <td className="py-2 text-right text-emerald-600 font-medium">{r.won}</td>
                    <td className="py-2 text-right text-red-500 font-medium">{r.lost}</td>
                    <td className="py-2 text-right font-bold text-navy">
                      {r.win_rate != null ? `${r.win_rate}%` : '—'}
                    </td>
                    <td className="py-2 pl-4">
                      {r.win_rate != null && (
                        <MiniBar pct={r.win_rate} color="#10B981" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function RevenueTab({ mrr }) {
  if (!mrr) return null
  const maxRev = Math.max(...(mrr.monthly?.map(m => m.revenue) || [1]), 1)

  const handleExport = () => {
    exportCSV(
      mrr.monthly?.map(m => ({
        month: new Date(m.month).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
        revenue: m.revenue,
        deals_closed: m.deals_closed,
        avg_deal_size: m.avg_deal_size,
      })),
      'monthly-revenue.csv'
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <DashboardCard
          title="YTD Revenue"
          value={formatCurrency(mrr.ytd_revenue)}
          subtitle={`${mrr.ytd_deals} deals closed this year`}
          icon="📅"
          color="teal"
        />
        <DashboardCard
          title="Current Month"
          value={formatCurrency(mrr.current_month_revenue)}
          subtitle="revenue this month"
          icon="💸"
          color="emerald"
        />
        <DashboardCard
          title="MoM Trend"
          value={mrr.mom_trend_pct != null ? `${mrr.mom_trend_pct > 0 ? '+' : ''}${mrr.mom_trend_pct}%` : 'N/A'}
          subtitle="vs previous month"
          icon="📈"
          color={mrr.mom_trend_pct >= 0 ? 'emerald' : 'rose'}
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-navy">Monthly Revenue (last 24 months)</h3>
          <button
            onClick={handleExport}
            className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            ↓ Export CSV
          </button>
        </div>
        {!mrr.monthly?.length ? (
          <p className="text-sm text-brand-gray text-center py-8">No closed deals yet. Win deals to see revenue trends.</p>
        ) : (
          <>
            <div className="flex items-end gap-1.5 h-40 mb-4">
              {mrr.monthly.map((m, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div
                    className="w-full bg-teal hover:bg-teal/80 rounded-t transition-all cursor-default"
                    style={{ height: `${(m.revenue / maxRev) * 100}%`, minHeight: m.revenue > 0 ? 4 : 2 }}
                  />
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 bg-navy text-white text-xs rounded px-2 py-1 whitespace-nowrap pointer-events-none">
                    {formatMonth(m.month)}: {formatCurrency(m.revenue)}<br />
                    {m.deals_closed} deal{m.deals_closed !== 1 ? 's' : ''}
                  </div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left font-semibold text-brand-gray pb-2">Month</th>
                    <th className="text-right font-semibold text-brand-gray pb-2">Revenue</th>
                    <th className="text-right font-semibold text-brand-gray pb-2">Deals Closed</th>
                    <th className="text-right font-semibold text-brand-gray pb-2">Avg Deal Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[...mrr.monthly].reverse().map((m, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="py-2 font-medium text-navy">{formatMonth(m.month)}</td>
                      <td className="py-2 text-right font-bold text-navy">{formatCurrency(m.revenue)}</td>
                      <td className="py-2 text-right text-brand-gray">{m.deals_closed}</td>
                      <td className="py-2 text-right text-brand-gray">{formatCurrency(m.avg_deal_size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ServiceLinesTab({ serviceLines }) {
  const handleExport = () => {
    exportCSV(
      serviceLines?.map(r => ({
        service_line: r.service_line,
        total_deals: r.total_deals,
        won: r.won,
        lost: r.lost,
        active: r.active,
        win_rate_pct: r.win_rate ?? '',
        total_revenue: r.total_revenue,
        avg_deal_size: r.avg_deal_size,
        avg_won_value: r.avg_won_value,
        avg_days_to_win: r.avg_days_to_win ?? '',
      })),
      'service-line-performance.csv'
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-navy">Service Line Performance</h3>
            <p className="text-xs text-brand-gray mt-0.5">Close rate, revenue, and deal size by service line</p>
          </div>
          <button
            onClick={handleExport}
            className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            ↓ Export CSV
          </button>
        </div>
        {!serviceLines?.length ? (
          <p className="text-sm text-brand-gray text-center py-8">No deals with service lines found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left font-semibold text-brand-gray pb-2">Service Line</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Deals</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Won</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Lost</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Win Rate</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Revenue</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Avg Size</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Avg Won</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Avg Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {serviceLines.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="py-2.5 font-medium text-navy">{formatServiceLine(r.service_line)}</td>
                    <td className="py-2.5 text-right text-brand-gray">{r.total_deals}</td>
                    <td className="py-2.5 text-right text-emerald-600 font-medium">{r.won}</td>
                    <td className="py-2.5 text-right text-red-500 font-medium">{r.lost}</td>
                    <td className="py-2.5 text-right">
                      <span className={`font-bold ${
                        r.win_rate != null && r.win_rate >= 50 ? 'text-emerald-600' : 'text-amber-600'
                      }`}>
                        {r.win_rate != null ? `${r.win_rate}%` : '—'}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-semibold text-navy">{formatCurrency(r.total_revenue)}</td>
                    <td className="py-2.5 text-right text-brand-gray">{formatCurrency(r.avg_deal_size)}</td>
                    <td className="py-2.5 text-right text-brand-gray">{formatCurrency(r.avg_won_value)}</td>
                    <td className="py-2.5 text-right text-brand-gray">
                      {r.avg_days_to_win != null ? `${r.avg_days_to_win}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bar chart of win rates */}
      {serviceLines?.filter(r => r.win_rate != null).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-navy mb-4">Win Rate by Service Line</h3>
          <div className="space-y-3">
            {serviceLines.filter(r => r.win_rate != null).map((r, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <span className="text-xs font-medium text-navy w-36 truncate shrink-0">
                  {formatServiceLine(r.service_line)}
                </span>
                <MiniBar pct={r.win_rate} color="#10B981" />
                <span className="text-xs font-bold text-navy w-12 text-right">{r.win_rate}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function VelocityTab({ velocity }) {
  if (!velocity) return null

  const handleExport = () => {
    exportCSV(
      velocity.by_service_line?.map(r => ({
        service_line: r.service_line,
        total: r.total,
        won: r.won,
        avg_days_to_win: r.avg_days_to_win ?? '',
      })),
      'deal-velocity.csv'
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <DashboardCard
          title="Avg Sales Cycle"
          value={velocity.avg_sales_cycle_days != null ? `${velocity.avg_sales_cycle_days}d` : 'N/A'}
          subtitle="days from creation to close"
          icon="⏱️"
          color="teal"
        />
        <DashboardCard
          title="Avg Days to Win"
          value={velocity.avg_days_to_win != null ? `${velocity.avg_days_to_win}d` : 'N/A'}
          subtitle={`across ${velocity.won_count} won deals`}
          icon="🏆"
          color="emerald"
        />
        <DashboardCard
          title="Avg Days to Lose"
          value={velocity.avg_days_to_lose != null ? `${velocity.avg_days_to_lose}d` : 'N/A'}
          subtitle={`across ${velocity.lost_count} lost deals`}
          icon="❌"
          color="rose"
        />
      </div>

      {/* Velocity by service line */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-navy">Deal Velocity by Service Line</h3>
            <p className="text-xs text-brand-gray mt-0.5">Average days from deal creation to closed-won</p>
          </div>
          <button
            onClick={handleExport}
            className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            ↓ Export CSV
          </button>
        </div>
        {!velocity.by_service_line?.filter(r => r.avg_days_to_win != null).length ? (
          <p className="text-sm text-brand-gray text-center py-8">
            Close at least one deal with a close date to see velocity metrics.
          </p>
        ) : (
          <div className="space-y-3">
            {velocity.by_service_line.filter(r => r.avg_days_to_win != null).map((r, idx) => {
              const maxDays = Math.max(...velocity.by_service_line.map(x => x.avg_days_to_win || 0), 1)
              return (
                <div key={idx} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-navy w-36 truncate shrink-0">
                    {formatServiceLine(r.service_line)}
                  </span>
                  <MiniBar pct={(r.avg_days_to_win / maxDays) * 100} color="#3B82F6" />
                  <span className="text-xs font-bold text-navy w-16 text-right">{r.avg_days_to_win}d</span>
                  <span className="text-xs text-brand-gray w-16 text-right">{r.won} won</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Stage transition history if available */}
      {velocity.stage_transitions?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-navy mb-4">Stage Transition Analysis</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left font-semibold text-brand-gray pb-2">From Stage</th>
                  <th className="text-left font-semibold text-brand-gray pb-2">To Stage</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Transitions</th>
                  <th className="text-right font-semibold text-brand-gray pb-2">Avg Days in Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {velocity.stage_transitions.map((t, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="py-2 font-medium capitalize" style={{ color: STAGE_COLORS[t.from_stage] || '#6B7280' }}>
                      {(t.from_stage || '—').replace('_', ' ')}
                    </td>
                    <td className="py-2 font-medium capitalize" style={{ color: STAGE_COLORS[t.to_stage] || '#6B7280' }}>
                      {t.to_stage.replace('_', ' ')}
                    </td>
                    <td className="py-2 text-right text-brand-gray">{t.transitions}</td>
                    <td className="py-2 text-right text-brand-gray">
                      {t.avg_days_in_from_stage != null ? `${t.avg_days_in_from_stage}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page component ─────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'win-loss', label: 'Win / Loss' },
  { key: 'revenue', label: 'Revenue & MRR' },
  { key: 'service-lines', label: 'Service Lines' },
  { key: 'velocity', label: 'Deal Velocity' },
]

export default function Analytics() {
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [winLoss, setWinLoss] = useState(null)
  const [velocity, setVelocity] = useState(null)
  const [mrr, setMrr] = useState(null)
  const [serviceLines, setServiceLines] = useState(null)

  const fetchAll = useCallback(async () => {
    const authHeaders = { headers: { Authorization: `Bearer ${token}` } }
    setLoading(true)
    setError(null)
    try {
      const [wlRes, velRes, mrrRes, slRes] = await Promise.all([
        axios.get('/api/analytics/deals/win-loss', authHeaders),
        axios.get('/api/analytics/deals/velocity', authHeaders),
        axios.get('/api/analytics/deals/mrr', authHeaders),
        axios.get('/api/analytics/deals/service-lines', authHeaders),
      ])
      setWinLoss(wlRes.data)
      setVelocity(velRes.data)
      setMrr(mrrRes.data)
      setServiceLines(slRes.data)
    } catch (err) {
      console.error('Error loading analytics:', err)
      setError('Failed to load analytics data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleExportAll = () => {
    // Export a combined summary CSV
    const rows = serviceLines?.map(r => ({
      service_line: r.service_line,
      total_deals: r.total_deals,
      won: r.won,
      lost: r.lost,
      win_rate_pct: r.win_rate ?? '',
      total_revenue: r.total_revenue,
      avg_deal_size: r.avg_deal_size,
      avg_days_to_win: r.avg_days_to_win ?? '',
    }))
    if (rows) exportCSV(rows, 'analytics-summary.csv')
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-syne text-2xl font-bold text-navy">Analytics &amp; Reporting</h2>
          <p className="text-xs text-brand-gray mt-0.5">Pipeline forecasting, win/loss analysis, and performance metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportAll}
            disabled={loading || !serviceLines}
            className="text-sm border border-gray-200 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            ↓ Export Report
          </button>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="text-sm bg-teal text-white px-4 py-2 rounded-lg hover:bg-teal/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading…' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`text-sm font-medium px-4 py-2.5 border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-teal text-teal'
                : 'border-transparent text-gray-500 hover:text-navy hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center py-24 text-sm text-brand-gray">
          Loading analytics data…
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-6 text-sm text-red-700">
          {error}
          <button onClick={fetchAll} className="ml-3 underline">Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {activeTab === 'overview' && (
            <OverviewTab winLoss={winLoss} velocity={velocity} mrr={mrr} serviceLines={serviceLines} />
          )}
          {activeTab === 'win-loss' && <WinLossTab winLoss={winLoss} />}
          {activeTab === 'revenue' && <RevenueTab mrr={mrr} />}
          {activeTab === 'service-lines' && <ServiceLinesTab serviceLines={serviceLines} />}
          {activeTab === 'velocity' && <VelocityTab velocity={velocity} />}
        </>
      )}
    </div>
  )
}
