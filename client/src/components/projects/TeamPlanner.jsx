import { useState, useMemo } from 'react'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'

export default function TeamPlanner({ projectId, tasks = [], members = [], users = [], onReload }) {
  const { token } = useAuth()
  const headers = { headers: { Authorization: `Bearer ${token}` } }

  const [viewMode, setViewMode] = useState('week') // 'week' | 'month'
  const [selectedUserId, setSelectedUserId] = useState('')
  const [assignments, setAssignments] = useState([])
  const [dailyLoad, setDailyLoad] = useState([])
  const [loading, setLoading] = useState(false)

  // Date range
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  const [rangeStart, setRangeStart] = useState(startOfWeek.toISOString().slice(0, 10))

  const daysToShow = viewMode === 'week' ? 7 : 30
  const dates = useMemo(() => {
    const arr = []
    const start = new Date(rangeStart)
    for (let i = 0; i < daysToShow; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      arr.push(d.toISOString().slice(0, 10))
    }
    return arr
  }, [rangeStart, daysToShow])

  const loadWorkload = async () => {
    setLoading(true)
    try {
      const end = dates[dates.length - 1]
      const { data } = await axios.get(
        `/api/projects/${projectId}/workload?from=${rangeStart}&to=${end}`,
        headers
      )
      setAssignments(data.assignments || [])
      setDailyLoad(data.daily || [])
    } catch (err) {
      console.error('Failed to load workload', err)
    } finally {
      setLoading(false)
    }
  }

  // Build a map: userId -> date -> allocation%
  const workloadMap = useMemo(() => {
    const map = new Map()
    for (const row of dailyLoad) {
      const key = `${row.user_id}|${row.work_date}`
      map.set(key, Number(row.total_allocation) || 0)
    }
    return map
  }, [dailyLoad])

  const getAllocation = (userId, date) => {
    return workloadMap.get(`${userId}|${date}`) || 0
  }

  const getBarStyle = (pct) => {
    if (pct > 100) return { backgroundColor: '#EF4444', color: '#fff' }
    if (pct >= 80) return { backgroundColor: '#F59E0B', color: '#fff' }
    if (pct > 0) return { backgroundColor: '#10B981', color: '#fff' }
    return { backgroundColor: '#F3F4F6', color: '#9CA3AF' }
  }

  // Only show project members + users who have assignments
  const memberUserIds = new Set(members.filter((m) => m.user_id).map((m) => m.user_id))
  const assignedUserIds = new Set(dailyLoad.map((d) => d.user_id))
  const displayUsers = users.filter((u) => memberUserIds.has(u.id) || assignedUserIds.has(u.id))

  return (
    <div className="bg-white border rounded-lg shadow-sm">
      {/* Header */}
      <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Team Planner</h2>
          <p className="text-sm text-gray-600">Resource allocation and workload view</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border-gray-300 text-sm"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
          >
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          <input
            type="date"
            className="rounded-md border-gray-300 text-sm"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
          />
          <button
            onClick={loadWorkload}
            className="px-3 py-2 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 pb-2 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> &lt;80%</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" /> 80–100%</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> &gt;100%</span>
      </div>

      {/* Grid */}
      <div className="overflow-auto">
        <table className="min-w-full border-t text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 border-b w-48">Member</th>
              {dates.map((d) => (
                <th key={d} className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-b w-16">
                  <div>{new Date(d).toLocaleDateString('en-US', { weekday: 'narrow' })}</div>
                  <div className="text-[10px] text-gray-400">{new Date(d).getDate()}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayUsers.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-sm text-gray-500" colSpan={dates.length + 1}>
                  No team members. Add members to the project to see workload.
                </td>
              </tr>
            ) : (
              displayUsers.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 border-b font-medium text-gray-800 text-sm">
                    {u.name || u.email}
                  </td>
                  {dates.map((d) => {
                    const pct = getAllocation(u.id, d)
                    const style = getBarStyle(pct)
                    return (
                      <td key={d} className="px-1 py-1 border-b text-center">
                        <div
                          className="mx-auto w-10 h-8 rounded flex items-center justify-center text-[10px] font-bold"
                          style={style}
                          title={`${pct}% allocated`}
                        >
                          {pct > 0 ? `${pct}%` : '—'}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Assignments list */}
      {assignments.length > 0 && (
        <div className="p-4 border-t">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Scheduled Assignments</h3>
          <div className="space-y-1 max-h-48 overflow-auto">
            {assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm py-1 px-2 bg-gray-50 rounded">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{a.task_id || a.task_name}</span>
                  <span className="text-gray-400">→</span>
                  <span className="text-gray-600">{a.user_name || a.email}</span>
                  <span className="text-xs text-gray-400">
                    {a.start_date} to {a.end_date} ({a.allocation_percent}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
