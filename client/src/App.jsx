import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import DashboardLayout from './components/DashboardLayout'
import Overview from './pages/Overview'
import Contacts from './pages/Contacts'
import Pipeline from './pages/Pipeline'
import Workflows from './pages/Workflows'
import Settings from './pages/Settings'
import Users from './pages/Users'
import Teams from './pages/Teams'
import AuditLogs from './pages/AuditLogs'
import Reminders from './pages/Reminders'
import Proposals from './pages/Proposals'
import Invoices from './pages/Invoices'
import TimeTracking from './pages/TimeTracking'
import Calendar from './pages/Calendar'
import BookingPage from './pages/BookingPage'
import ClientPortalApp from './ClientApp'
import Help from './pages/Help'

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  const { isAuthenticated } = useAuth()
  return (
    <Routes>
      {/* Client Portal Routes */}
      <Route path="/client/*" element={<ClientPortalApp />} />

      {/* Employee Portal Routes */}
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/book/:slug" element={<BookingPage />} />
      <Route path="/" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<Overview />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="settings" element={<Settings />} />
        <Route path="teams" element={<Teams />} />
        <Route path="audit-logs" element={<AuditLogs />} />
        <Route path="users" element={<Users />} />
        <Route path="reminders" element={<Reminders />} />
        <Route path="proposals" element={<Proposals />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="time-tracking" element={<TimeTracking />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="help" element={<Help />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
