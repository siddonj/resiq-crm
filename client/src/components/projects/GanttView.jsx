import { useMemo, useState } from 'react'

const DAY_MS = 86400000

function parseDate(val) {
  if (!val) return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d
}

export default function GanttView({ columns = [], tasks = [], filterText = '', onAddTask, onUpdateTask, onTaskClick }) {
  // Filter
  const lowerFilter = filterText.toLowerCase()
  const filteredTasks = lowerFilter
    ? tasks.filter((t) => (t.name || '').toLowerCase().includes(lowerFilter) || (t.task_id || '').toLowerCase().includes(lowerFilter))
    : tasks

  // Find date columns for start/end
  const dateCols = useMemo(() => columns.filter((c) => c.type === 'date'), [columns])
  const startCol = dateCols[0]
  const endCol = dateCols[1] || dateCols[0]

  const [daysOffset, setDaysOffset] = useState(0)
  const DAYS_VISIBLE = 30
  const CELL_W = 36

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + daysOffset)
    return d
  }, [daysOffset])

  const dateLabels = useMemo(() => {
    const arr = []
    for (let i = 0; i < DAYS_VISIBLE; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      arr.push({ date: d, day: d.getDate(), month: d.getMonth(), label: `${d.getMonth() + 1}/${d.getDate()}` })
    }
    return arr
  }, [today])

  const monthSections = useMemo(() => {
    const sections = []
    let current = null
    dateLabels.forEach((d, i) => {
      if (!current || current.month !== d.month) {
        current = { month: d.month, label: d.date.toLocaleDateString('en', { month: 'short', year: 'numeric' }), start: i, count: 0 }
        sections.push(current)
      }
      current.count++
    })
    return sections
  }, [dateLabels])

  const ganttTasks = useMemo(() => {
    if (!startCol) return []
    return filteredTasks
      .map((t) => {
        const startVal = t.values?.[startCol.key]
        const endVal = endCol ? t.values?.[endCol.key] : null
        const s = parseDate(startVal)
        const e = parseDate(endVal) || s
        return { ...t, _start: s, _end: e }
      })
      .filter((t) => t._start)
      .sort((a, b) => (a._start - b._start) || (a._end - b._end))
  }, [tasks, startCol, endCol])

  const getBarStyle = (t) => {
    const rangeEnd = new Date(today)
    rangeEnd.setDate(rangeEnd.getDate() + DAYS_VISIBLE)
    const rangeStart = today

    const taskStart = t._start
    const taskEnd = t._end || t._start

    if (taskEnd < rangeStart || taskStart > rangeEnd) return { display: 'none' }

    const totalRange = rangeEnd - rangeStart
    const left = Math.max(0, (taskStart - rangeStart) / totalRange)
    const width = Math.min(1 - left, Math.max(0.02, (taskEnd - taskStart) / totalRange || (1 / DAYS_VISIBLE)))

    return {
      left: `${(left * 100).toFixed(1)}%`,
      width: `${(width * 100).toFixed(1)}%`,
    }
  }

  const getDayOffset = (date) => {
    const d = parseDate(date)
    if (!d) return -1
    const diff = (d - today) / DAY_MS
    return Math.floor(diff)
  }

  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Gantt</h2>
          <p className="text-sm text-gray-600">
            {filterText ? `Filtered: ${filteredTasks.length} of ${tasks.length} · ` : ''}
            {startCol ? `Timeline by ${startCol.name}${endCol && endCol !== startCol ? ` → ${endCol.name}` : ''}` : 'Add date columns to use Gantt view'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDaysOffset((p) => p - DAYS_VISIBLE)} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">&larr;</button>
          <button onClick={() => setDaysOffset(0)} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Today</button>
          <button onClick={() => setDaysOffset((p) => p + DAYS_VISIBLE)} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">&rarr;</button>
        </div>
      </div>

      {!startCol ? (
        <div className="text-sm text-gray-500 py-4 text-center">
          Add a Date column to enable the Gantt timeline view.
        </div>
      ) : (
        <div className="overflow-auto border rounded">
          {/* Month header */}
          <div className="flex border-b bg-gray-50" style={{ minWidth: DAYS_VISIBLE * CELL_W }}>
            {monthSections.map((m) => (
              <div
                key={m.month}
                className="text-xs font-semibold text-gray-700 px-2 py-1 border-r text-center"
                style={{ width: m.count * CELL_W }}
              >
                {m.label}
              </div>
            ))}
          </div>
          {/* Day header */}
          <div className="flex border-b bg-gray-50" style={{ minWidth: DAYS_VISIBLE * CELL_W }}>
            {dateLabels.map((d, i) => (
              <div
                key={i}
                className={`text-xs text-center py-1 border-r ${
                  d.date.toDateString() === new Date().toDateString() ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-600'
                }`}
                style={{ width: CELL_W }}
              >
                {d.day}
              </div>
            ))}
          </div>

          {/* Task bars */}
          <div className="relative" style={{ minWidth: DAYS_VISIBLE * CELL_W }}>
            {/* Weekend shading */}
            {dateLabels.map((d, i) => {
              const dayOfWeek = d.date.getDay()
              if (dayOfWeek !== 0 && dayOfWeek !== 6) return null
              return (
                <div
                  key={`bg-${i}`}
                  className="absolute top-0 bottom-0 bg-gray-100/50 pointer-events-none"
                  style={{ left: i * CELL_W, width: CELL_W }}
                />
              )
            })}

            {/* Today line */}
            {(() => {
              const todayOffset = getDayOffset(new Date().toDateString())
              if (todayOffset < 0 || todayOffset >= DAYS_VISIBLE) return null
              return (
                <div
                  className="absolute top-0 bottom-0 w-px bg-indigo-400 z-10"
                  style={{ left: (todayOffset + 0.5) * CELL_W }}
                />
              )
            })()}

            {ganttTasks.length === 0 ? (
              <div className="py-8 text-sm text-gray-500 text-center">No tasks with dates in this range.</div>
            ) : (
              ganttTasks.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() => onTaskClick?.(t)}
                >
                  <div className="w-40 flex-shrink-0 px-2 py-1.5 text-xs text-gray-800 truncate border-r">
                    {t.name}
                  </div>
                  <div className="flex-1 relative h-8">
                    <div
                      className="absolute top-1 h-6 rounded bg-indigo-500 hover:bg-indigo-600 transition-colors flex items-center px-1.5 cursor-pointer min-w-[8px]"
                      style={getBarStyle(t)}
                      title={`${t.name}: ${t._start?.toLocaleDateString()} → ${t._end?.toLocaleDateString()}`}
                    >
                      <span className="text-white text-[10px] truncate">{t.name}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
