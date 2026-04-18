import { useState, useEffect } from 'react'
import ContactsSummary from '../components/dashboard/ContactsSummary'
import PipelineSummary from '../components/dashboard/PipelineSummary'
import EmailMetrics from '../components/dashboard/EmailMetrics'
import WorkflowMetrics from '../components/dashboard/WorkflowMetrics'

export default function Overview() {
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    if (!autoRefresh) return

    // Auto-refresh every 60 seconds
    const interval = setInterval(() => {
      setLastUpdated(new Date())
      // Trigger a refresh by re-rendering components (they'll fetch new data)
    }, 60000)

    return () => clearInterval(interval)
  }, [autoRefresh])

  const formattedTime = lastUpdated.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-syne text-2xl font-bold text-navy">Dashboard</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-brand-gray">Auto-refresh</span>
          </label>
          <p className="text-xs text-brand-gray">Updated {formattedTime}</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Contact Management Section */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <ContactsSummary />
        </div>

        {/* Sales Pipeline Section */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <PipelineSummary />
        </div>

        {/* Email Activity Section */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <EmailMetrics />
        </div>

        {/* Workflow Automation Section */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <WorkflowMetrics />
        </div>
      </div>
    </div>
  )
}
