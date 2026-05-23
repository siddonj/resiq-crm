import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSidebar } from './SidebarContext'
import icons from './NavIcons'

const navGroups = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Overview', icon: 'overview', end: true },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/pipeline', label: 'Pipeline', icon: 'pipeline' },
      { to: '/contacts', label: 'Contacts', icon: 'contacts' },
      { to: '/forecasting', label: 'Forecasting', icon: 'forecasting' },
      { to: '/analytics', label: 'Analytics', icon: 'analytics' },
    ],
  },
  {
    label: 'Outreach',
    items: [
      { to: '/outbound-automation/leads', label: 'Outbound', icon: 'outbound' },
      { to: '/email-campaigns', label: 'Email Campaigns', icon: 'emailcampaigns' },
      { to: '/agents', label: 'AI Agents', icon: 'agents' },
      { to: '/forms', label: 'Web Forms', icon: 'forms' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/projects', label: 'Projects', icon: 'projects' },
      { to: '/portfolios', label: 'Portfolios', icon: 'portfolios' },
      { to: '/proposals', label: 'Proposals', icon: 'proposals' },
      { to: '/invoices', label: 'Invoices', icon: 'invoices' },
      { to: '/time-tracking', label: 'Time Tracking', icon: 'time' },
      { to: '/calendar', label: 'Calendar', icon: 'calendar' },
      { to: '/help-desk', label: 'Help Desk', icon: 'helpdesk' },
      { to: '/reminders', label: 'Reminders', icon: 'reminders' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/settings', label: 'Settings', icon: 'settings' },
      { to: '/teams', label: 'Teams', icon: 'teams', roles: ['admin', 'manager'] },
      { to: '/users', label: 'Users', icon: 'users', roles: ['admin', 'manager'] },
      { to: '/audit-logs', label: 'Audit Logs', icon: 'audit', roles: ['admin', 'manager'] },
      { to: '/help', label: 'Help', icon: 'help' },
    ],
  },
]

function isItemActive(to, pathname) {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(to + '/')
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const { isSidebarOpen, closeSidebar } = useSidebar()
  const role = user?.role

  return (
    <>
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-72 bg-navy text-white flex flex-col
          transition-transform duration-300 ease-in-out
          lg:static lg:w-60 lg:z-auto lg:translate-x-0
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo + close button */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/10">
          <div>
            <h1 className="font-syne text-xl font-bold text-white tracking-tight">
              Resi<span className="text-teal">Q</span>
            </h1>
            <p className="text-brand-gray text-[11px] mt-0.5 font-medium">CRM Platform</p>
          </div>
          {/* Close button — visible on mobile only */}
          <button
            onClick={closeSidebar}
            className="lg:hidden text-brand-gray/60 hover:text-white transition-colors p-1"
            aria-label="Close sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navGroups
            .filter(g => !g.roles || g.roles.includes(role))
            .map(group => (
              <div key={group.label}>
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-brand-gray/60">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items
                    .filter(item => !item.roles || item.roles.includes(role))
                    .map(item => {
                      const active = isItemActive(item.to, pathname)
                      const Icon = icons[item.icon]
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.end}
                          onClick={closeSidebar}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                            active
                              ? 'bg-teal text-white shadow-sm shadow-teal/20'
                              : 'text-brand-gray hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <span className={`flex-shrink-0 ${active ? 'text-white' : 'text-brand-gray/70'}`}>
                            {Icon}
                          </span>
                          <span>{item.label}</span>
                        </NavLink>
                      )
                    })}
                </div>
              </div>
            ))}
        </nav>

        {/* User footer */}
        <div className="px-4 py-3.5 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-teal/20 flex items-center justify-center text-xs font-bold text-teal flex-shrink-0">
              {user?.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium truncate leading-tight">{user?.name}</p>
              <p className="text-[11px] text-brand-gray truncate">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="text-brand-gray/50 hover:text-teal transition-colors p-1"
              title="Sign out"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
