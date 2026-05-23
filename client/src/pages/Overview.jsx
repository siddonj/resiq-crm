import { useState, useEffect, useCallback } from 'react'
import ContactsSummary from '../components/dashboard/ContactsSummary'
import PipelineSummary from '../components/dashboard/PipelineSummary'
import EmailMetrics from '../components/dashboard/EmailMetrics'
import WorkflowMetrics from '../components/dashboard/WorkflowMetrics'
import DueReminders from '../components/dashboard/DueReminders'

export default function Overview() {
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshKey(k => k + 1)
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  const formattedTime = new Date().toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <ContactsSummary key={`contacts-${refreshKey}`} />
        <PipelineSummary key={`pipeline-${refreshKey}`} />
        <EmailMetrics key={`email-${refreshKey}`} />
        <WorkflowMetrics key={`workflow-${refreshKey}`} />
      </div>

      {/* Reminders & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
            <h3 className="text-xs sm:text-sm font-semibold text-navy mb-3">Due Reminders</h3>
            <DueReminders key={`reminders-${refreshKey}`} />
          </div>
        </div>
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs sm:text-sm font-semibold text-navy">Activity</h3>
              <span className="text-[10px] sm:text-[11px] text-brand-gray">{formattedTime}</span>
            </div>
            <p className="text-xs text-brand-gray text-center py-6 sm:py-8">Activity feed coming soon</p>
          </div>
        </div>
      </div>
    </div>
  )
}
