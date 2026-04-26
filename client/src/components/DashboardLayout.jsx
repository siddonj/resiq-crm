import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const navItems = [
  { to: '/', label: 'Overview', icon: '📊', end: true },
  { to: '/contacts', label: 'Contacts', icon: '👥' },
  { to: '/pipeline', label: 'Pipeline', icon: '🔁' },
  { to: '/workflows', label: 'Workflows', icon: '⚡' },    { to: '/sequences', label: 'Sequences', icon: '✉️' },  { to: '/agents', label: 'AI Agents', icon: '🤖' },
  { to: '/forms', label: 'Web Forms', icon: '🌐' },
  { to: '/reminders', label: 'Reminders', icon: '🔔' },
  { to: '/proposals', label: 'Proposals', icon: '📄' },
  { to: '/invoices', label: 'Invoices', icon: '🧾' },
  { to: '/time-tracking', label: 'Time Tracking', icon: '⏱' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/help-desk', label: 'Help Desk', icon: '🎟️' },
  { to: '/help', label: 'Help', icon: '❓' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

const adminNavItems = [
  { to: '/teams', label: 'Teams', icon: '🏢', roles: ['admin', 'manager'] },
  { to: '/audit-logs', label: 'Audit Logs', icon: '📋', roles: ['admin', 'manager'] },
  { to: '/users', label: 'Users', icon: '👨‍💼', roles: ['admin'] },
]

export default function DashboardLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex h-screen bg-gray-100 font-dmsans">
      {/* Sidebar */}
      <aside className="w-64 bg-navy text-white flex flex-col">
        {/* Logo */}
        <div className="px-6 py-6 border-b border-white/10">
          <h1 className="font-syne text-2xl font-bold text-white">
            Resi<span className="text-teal">Q</span>
          </h1>
          <p className="text-brand-gray text-xs mt-0.5">CRM Platform</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navItems.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-teal text-white'
                    : 'text-brand-gray hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
          {adminNavItems.some(item => item.roles.includes(user?.role)) && (
            <>
              <div className="my-2 border-t border-white/10" />
              {adminNavItems.filter(item => item.roles.includes(user?.role)).map(({ to, label, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-teal text-white'
                        : 'text-brand-gray hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <span>{icon}</span>
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User */}
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

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
