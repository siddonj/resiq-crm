import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const nav = [
  { label: 'Overview', path: '/' },
  { label: 'Contacts', path: '/contacts' },
  { label: 'Pipeline', path: '/pipeline' },
]

export default function Sidebar() {
  const { user, logout } = useAuth()
  return (
    <aside className="w-60 bg-navy text-white flex flex-col py-8 px-5 shrink-0">
      <div className="mb-10">
        <h1 className="text-xl font-bold tracking-wide" style={{ fontFamily: 'Syne' }}>ResiQ</h1>
        <p className="text-xs text-teal mt-0.5">CRM</p>
      </div>
      <nav className="flex-1 space-y-1">
        {nav.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `block px-4 py-2.5 rounded-lg text-sm transition font-medium ${
                isActive ? 'bg-teal text-white' : 'text-gray-300 hover:bg-white/10'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 pt-4 mt-4">
        <p className="text-xs text-gray-400 mb-2">{user?.name}</p>
        <button onClick={logout} className="text-xs text-gray-400 hover:text-white transition">
          Sign out
        </button>
      </div>
    </aside>
  )
}
