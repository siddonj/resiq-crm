import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useClientAuth } from '../context/ClientAuthContext'

export default function ClientLayout() {
  const { client, logout } = useClientAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const handleLogout = () => {
    logout()
    navigate('/client/login')
  }

  const menuItems = [
    { label: 'Dashboard', href: '/client', icon: '📊' },
    { label: 'Proposals', href: '/client/proposals', icon: '📄' },
    { label: 'Invoices', href: '/client/invoices', icon: '💳' },
    { label: 'Files', href: '/client/files', icon: '📁' },
    { label: 'Activity', href: '/client/activity', icon: '⏱️' },
  ]

  const isActive = (href) => location.pathname === href

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-white border-r border-gray-200 transition-all duration-300 flex flex-col`}
      >
        {/* Logo */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold text-blue-600">ResiQ</span>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1 hover:bg-gray-100 rounded"
              title="Toggle sidebar"
            >
              ☰
            </button>
          </div>
          {sidebarOpen && <p className="text-sm text-gray-500 mt-2">Client Portal</p>}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {menuItems.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(item.href)
                  }}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive(item.href)
                      ? 'bg-blue-50 text-blue-600 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  title={!sidebarOpen ? item.label : ''}
                >
                  <span className="text-xl">{item.icon}</span>
                  {sidebarOpen && <span>{item.label}</span>}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* User Profile & Logout */}
        <div className="p-4 border-t border-gray-200">
          {sidebarOpen && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-900 truncate">{client?.name}</p>
              <p className="text-xs text-gray-500 truncate">{client?.email}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center space-x-3 px-4 py-3 text-gray-700 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
            title={!sidebarOpen ? 'Logout' : ''}
          >
            <span className="text-xl">🚪</span>
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Your Project Portal</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {client?.name}</span>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
