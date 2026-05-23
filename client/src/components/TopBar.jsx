import { useLocation } from 'react-router-dom'
import { useSidebar } from './SidebarContext'

// Map routes to display names
const routeNames = {
  '/': 'Overview',
  '/contacts': 'Contacts',
  '/pipeline': 'Pipeline',
  '/forecasting': 'Forecasting',
  '/analytics': 'Analytics',
  '/reminders': 'Reminders',
  '/settings': 'Settings',
  '/help': 'Help',
  '/teams': 'Teams',
  '/users': 'Users',
  '/audit-logs': 'Audit Logs',
  '/projects': 'Projects',
  '/portfolios': 'Portfolios',
  '/proposals': 'Proposals',
  '/invoices': 'Invoices',
  '/time-tracking': 'Time Tracking',
  '/calendar': 'Calendar',
  '/help-desk': 'Help Desk',
  '/agents': 'AI Agents',
  '/forms': 'Web Forms',
  '/outbound-automation': 'Outbound',
  '/email-campaigns': 'Email Campaigns',
  '/reddit-leads': 'Reddit Leads',
  '/multi-source-leads': 'Multi-Source Leads',
}

export default function TopBar() {
  const { pathname } = useLocation()
  const { toggleSidebar } = useSidebar()

  // Find the best matching route name
  const title = Object.entries(routeNames)
    .sort((a, b) => b[0].length - a[0].length) // longest match first
    .find(([path]) => pathname === path || pathname.startsWith(path + '/') || (path !== '/' && pathname.startsWith(path)))

  const pageTitle = title ? title[1] : 'ResiQ CRM'

  // Get sub-path context for breadcrumbs
  const segments = pathname.split('/').filter(Boolean)

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 sticky top-0 z-10">
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger — visible on mobile only */}
        <button
          onClick={toggleSidebar}
          className="lg:hidden flex-shrink-0 p-1.5 -ml-1 text-brand-gray hover:text-navy transition-colors rounded-lg hover:bg-gray-100"
          aria-label="Toggle sidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>

        <h2 className="text-lg font-semibold text-navy tracking-tight truncate">{pageTitle}</h2>
        {segments.length > 1 && (
          <>
            <span className="text-xs text-gray-300 hidden sm:inline">/</span>
            <span className="text-xs text-brand-gray capitalize truncate hidden sm:inline">
              {segments.slice(1).join(' / ')}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-[11px] text-brand-gray font-medium bg-gray-100 px-2.5 py-1 rounded-full">
          CRM v1.1
        </span>
      </div>
    </header>
  )
}
