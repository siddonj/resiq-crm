import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

// Login is eagerly loaded (entry point)
import Login from './pages/Login'

// Layout is eagerly loaded
import DashboardLayout from './components/DashboardLayout'

// Large pages — individual lazy chunks
const OutboundAutomation = lazy(() => import('./pages/OutboundAutomation'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Invoices = lazy(() => import('./pages/Invoices'))
const Proposals = lazy(() => import('./pages/Proposals'))
const Projects = lazy(() => import('./pages/Projects'))

// Medium pages — individually lazy
const Overview = lazy(() => import('./pages/Overview'))
const Contacts = lazy(() => import('./pages/Contacts'))
const Pipeline = lazy(() => import('./pages/Pipeline'))
const Forecasting = lazy(() => import('./pages/Forecasting'))
const Calendar = lazy(() => import('./pages/Calendar'))
const TimeTracking = lazy(() => import('./pages/TimeTracking'))
const Settings = lazy(() => import('./pages/Settings'))
const HelpDesk = lazy(() => import('./pages/HelpDesk'))
const Help = lazy(() => import('./pages/Help'))
const EmailCampaigns = lazy(() => import('./pages/EmailCampaigns'))
const MultiSourceLeads = lazy(() => import('./pages/MultiSourceLeads'))

// Smaller pages
const Users = lazy(() => import('./pages/Users'))
const Teams = lazy(() => import('./pages/Teams'))
const AuditLogs = lazy(() => import('./pages/AuditLogs'))
const Reminders = lazy(() => import('./pages/Reminders'))
const Agents = lazy(() => import('./pages/Agents'))
const Forms = lazy(() => import('./pages/Forms'))
const RedditLeads = lazy(() => import('./pages/RedditLeads'))
const BookingPage = lazy(() => import('./pages/BookingPage'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const Portfolios = lazy(() => import('./pages/Portfolios'))
const PortfolioDetail = lazy(() => import('./pages/PortfolioDetail'))

// Client portal is a separate app entry
const ClientPortalApp = lazy(() => import('./ClientApp'))

// Loading fallback
function PageLoader() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '60vh',
      color: '#6b7280',
      fontSize: '1.1rem'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 40,
          height: 40,
          border: '3px solid #e5e7eb',
          borderTopColor: '#3b82f6',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto 16px'
        }} />
        <span>Loading...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  const { isAuthenticated } = useAuth()
  return (
    <Suspense fallback={<PageLoader />}>
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
          <Route path="forecasting" element={<Forecasting />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="workflows" element={<Navigate to="/outbound-automation/execution" replace />} />
          <Route path="sequences" element={<Navigate to="/outbound-automation/execution" replace />} />
          <Route path="settings" element={<Settings />} />
          <Route path="teams" element={<Teams />} />
          <Route path="audit-logs" element={<AuditLogs />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:projectId" element={<ProjectDetail />} />
          <Route path="portfolios" element={<Portfolios />} />
          <Route path="portfolios/:portfolioId" element={<PortfolioDetail />} />
          <Route path="users" element={<Users />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="agents" element={<Agents />} />
          <Route path="forms" element={<Forms />} />
          <Route path="help-desk" element={<HelpDesk />} />
          <Route path="proposals" element={<Proposals />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="time-tracking" element={<TimeTracking />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="reddit-leads" element={<RedditLeads />} />
          <Route path="multi-source-leads" element={<MultiSourceLeads />} />
          <Route path="outbound-automation/*" element={<OutboundAutomation />} />
          <Route path="email-campaigns" element={<EmailCampaigns />} />
          <Route path="help" element={<Help />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
