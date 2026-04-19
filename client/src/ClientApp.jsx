import { Routes, Route, Navigate } from 'react-router-dom'
import { ClientAuthProvider, useClientAuth } from './context/ClientAuthContext'
import ClientLayout from './components/ClientLayout'
import ClientLogin from './pages/client/Login'
import ClientDashboard from './pages/client/Dashboard'
import ClientProposals from './pages/client/Proposals'
import ClientInvoices from './pages/client/Invoices'
import ClientFiles from './pages/client/Files'
import ClientActivity from './pages/client/Activity'

function ClientProtectedRoute({ children }) {
  const { isAuthenticated } = useClientAuth()
  return isAuthenticated ? children : <Navigate to="/client/login" replace />
}

function ClientRoutes() {
  const { isAuthenticated } = useClientAuth()
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/client" replace /> : <ClientLogin />} />
      <Route path="/" element={<ClientProtectedRoute><ClientLayout /></ClientProtectedRoute>}>
        <Route index element={<ClientDashboard />} />
        <Route path="proposals" element={<ClientProposals />} />
        <Route path="invoices" element={<ClientInvoices />} />
        <Route path="files" element={<ClientFiles />} />
        <Route path="activity" element={<ClientActivity />} />
      </Route>
    </Routes>
  )
}

export default function ClientPortalApp() {
  return (
    <ClientAuthProvider>
      <ClientRoutes />
    </ClientAuthProvider>
  )
}
