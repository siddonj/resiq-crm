import { Routes, Route } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Overview from './Overview'
import Contacts from './Contacts'
import Pipeline from './Pipeline'

export default function Dashboard() {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/pipeline" element={<Pipeline />} />
        </Routes>
      </main>
    </div>
  )
}
