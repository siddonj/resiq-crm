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

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  const { isAuthenticated } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<Overview />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="settings" element={<Settings />} />
        <Route path="teams" element={<Teams />} />
        <Route path="users" element={<Users />} />
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
