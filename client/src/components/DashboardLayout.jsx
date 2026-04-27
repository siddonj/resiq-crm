import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const navTabs = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { to: '/', label: 'Overview', end: true },
      { to: '/contacts', label: 'Contacts' },
      { to: '/pipeline', label: 'Pipeline' },
      { to: '/forecasting', label: 'Forecasting' },
      { to: '/analytics', label: 'Analytics' },
      { to: '/reminders', label: 'Reminders' },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    items: [
      { to: '/outbound-automation', label: 'Outbound' },
      { to: '/sequences', label: 'Sequences' },
      { to: '/workflows', label: 'Workflows' },
      { to: '/agents', label: 'AI Agents' },
      { to: '/forms', label: 'Web Forms' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: '/proposals', label: 'Proposals' },
      { to: '/invoices', label: 'Invoices' },
      { to: '/time-tracking', label: 'Time Tracking' },
      { to: '/calendar', label: 'Calendar' },
      { to: '/help-desk', label: 'Help Desk' },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { to: '/settings', label: 'Settings' },
      { to: '/help', label: 'Help' },
      { to: '/teams', label: 'Teams', roles: ['admin', 'manager'] },
      { to: '/users', label: 'Users', roles: ['admin', 'manager'] },
      { to: '/audit-logs', label: 'Audit Logs', roles: ['admin', 'manager'] },
    ],
  },
]

function hasRouteAccess(item, role) {
  if (!item.roles || item.roles.length === 0) return true
  return item.roles.includes(role)
}

function isItemActivePath(item, pathname) {
  if (item.to === '/') return pathname === '/'
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const role = user?.role

  const availableTabs = useMemo(
    () =>
      navTabs
        .map((tab) => ({
          ...tab,
          items: tab.items.filter((item) => hasRouteAccess(item, role)),
        }))
        .filter((tab) => tab.items.length > 0),
    [role]
  )

  const [activeTabId, setActiveTabId] = useState(availableTabs[0]?.id || 'workspace')

  useEffect(() => {
    const matchingTab =
      availableTabs.find((tab) => tab.items.some((item) => isItemActivePath(item, location.pathname))) ||
      availableTabs[0]

    if (matchingTab && matchingTab.id !== activeTabId) {
      setActiveTabId(matchingTab.id)
    }
  }, [location.pathname, availableTabs, activeTabId])

  const activeTab =
    availableTabs.find((tab) => tab.id === activeTabId) || availableTabs[0] || { label: 'Navigation', items: [] }

  return (
    <div className="flex h-screen bg-gray-100 font-dmsans">
      <aside className="w-64 bg-navy text-white flex flex-col">
        <div className="px-6 py-6 border-b border-white/10">
          <h1 className="font-syne text-2xl font-bold text-white">
            Resi<span className="text-teal">Q</span>
          </h1>
          <p className="text-brand-gray text-xs mt-0.5">CRM Platform</p>
        </div>

        <div className="px-4 py-4 border-b border-white/10">
          <div className="grid grid-cols-2 gap-1">
            {availableTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  tab.id === activeTab.id
                    ? 'bg-teal text-white'
                    : 'bg-white/5 text-brand-gray hover:bg-white/10 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 pb-2 text-[11px] uppercase tracking-wide text-brand-gray/80">
            {activeTab.label}
          </p>
          {activeTab.items.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-teal text-white'
                    : 'text-brand-gray hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-6 py-4 border-t border-white/10">
          <p className="text-sm text-white font-medium truncate">{user?.name}</p>
          <p className="text-xs text-brand-gray truncate">{user?.email}</p>
          <button
            onClick={logout}
            className="mt-3 text-xs text-brand-gray hover:text-teal transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
