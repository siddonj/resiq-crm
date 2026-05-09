import { useMemo, useState } from 'react'

function parseDate(val) {
  if (!val) return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d
}

function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function CalendarView({ columns = [], tasks = [], filterText = '', onAddTask, onUpdateTask, onTaskClick }) {
  const [viewDate, setViewDate] = useState(new Date())
  const [newTaskDate, setNewTaskDate] = useState('')
  const [newTaskName, setNewTaskName] = useState('')

  const lowerFilter = filterText.toLowerCase()
  const filteredTasks = lowerFilter
    ? tasks.filter((t) => (t.name || '').toLowerCase().includes(lowerFilter) || (t.task_id || '').toLowerCase().includes(lowerFilter))
    : tasks

  // Find first date column to use for calendar placement
  const dateCol = useMemo(() => columns.find((c) => c.type === 'date'), [columns])

  const month = viewDate.getMonth()
  const year = viewDate.getFullYear()

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()

  const days = useMemo(() => {
    const arr = []
    for (let d = 1; d <= daysInMonth; d++) {
      arr.push(new Date(year, month, d))
    }
    return arr
  }, [year, month, daysInMonth])

  const tasksByDay = useMemo(() => {
    if (!dateCol) return {}
    const map = {}
    filteredTasks.forEach((t) => {
      const d = parseDate(t.values?.[dateCol.key])
      if (!d) return
      const key = d.toDateString()
      if (!map[key]) map[key] = []
      map[key].push(t)
    })
    return map
  }, [tasks, dateCol])

  const prevMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const nextMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  const goToday = () => setViewDate(new Date())

  const handleAddTask = () => {
    if (!newTaskName.trim() || !newTaskDate || !dateCol) return
    const values = { [dateCol.key]: newTaskDate }
    onAddTask({ name: newTaskName.trim(), values })
    setNewTaskName('')
    setNewTaskDate('')
  }

  const today = new Date()
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="bg-white border rounded-lg shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Calendar</h2>
          <p className="text-sm text-gray-600">
            {filterText ? `Filtered: ${filteredTasks.length} of ${tasks.length} · ` : ''}
            {dateCol ? `Tasks by ${dateCol.name}` : 'Add a Date column to use Calendar view'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">&larr;</button>
          <button onClick={goToday} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Today</button>
          <span className="text-sm font-semibold text-gray-800 min-w-[140px] text-center">
            {viewDate.toLocaleDateString('en', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={nextMonth} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">&rarr;</button>
        </div>
      </div>

      {!dateCol ? (
        <div className="text-sm text-gray-500 py-4 text-center">Add a Date column to enable Calendar view.</div>
      ) : (
        <>
          {/* Quick add */}
          <div className="mb-3 flex gap-2">
            <input
              type="date"
              className="rounded-md border-gray-300 text-sm focus:ring-indigo-500 focus:border-indigo-500"
              value={newTaskDate}
              onChange={(e) => setNewTaskDate(e.target.value)}
            />
            <input
              className="flex-1 rounded-md border-gray-300 text-sm focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Task name"
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { handleAddTask(); e.preventDefault() } }}
            />
            <button
              onClick={handleAddTask}
              className="px-3 py-1 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Add
            </button>
          </div>

          {/* Calendar grid */}
          <div className="border rounded overflow-hidden">
            {/* Weekday header */}
            <div className="grid grid-cols-7 bg-gray-50">
              {weekDays.map((w) => (
                <div key={w} className="text-xs font-semibold text-gray-600 text-center py-2 border-r last:border-r-0">
                  {w}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7">
              {/* Empty cells for previous month */}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="h-24 border-r border-b bg-gray-50/50" />
              ))}

              {days.map((day) => {
                const key = day.toDateString()
                const dayTasks = tasksByDay[key] || []
                const isToday = sameDay(day, today)
                return (
                  <div
                    key={key}
                    className={`h-24 border-r border-b p-1 overflow-hidden ${
                      isToday ? 'bg-indigo-50' : 'bg-white'
                    }`}
                  >
                    <div className={`text-xs font-semibold mb-1 ${
                      isToday ? 'text-indigo-700 bg-indigo-200 rounded-full w-5 h-5 flex items-center justify-center' : 'text-gray-700'
                    }`}>
                      {day.getDate()}
                    </div>
                    <div className="space-y-0.5">
                      {dayTasks.slice(0, 3).map((t) => (
                        <div
                          key={t.id}
                          onClick={() => onTaskClick?.(t)}
                          className="text-[10px] bg-indigo-100 text-indigo-800 rounded px-1 py-0.5 truncate cursor-pointer hover:bg-indigo-200"
                        >
                          {t.name}
                        </div>
                      ))}
                      {dayTasks.length > 3 && (
                        <div className="text-[10px] text-gray-500 pl-1">+{dayTasks.length - 3} more</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
