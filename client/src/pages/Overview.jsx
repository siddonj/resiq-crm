const stats = [
  { label: 'Total Contacts', value: '—', color: 'bg-teal' },
  { label: 'Active Deals', value: '—', color: 'bg-navy' },
  { label: 'Pipeline Value', value: '—', color: 'bg-brand-gray' },
  { label: 'Closed Won', value: '—', color: 'bg-teal' },
]

export default function Overview() {
  return (
    <div className="p-8">
      <h2 className="font-syne text-2xl font-bold text-navy mb-6">Overview</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm p-6">
            <div className={`w-2 h-8 rounded-full ${color} mb-3`} />
            <p className="text-2xl font-syne font-bold text-navy">{value}</p>
            <p className="text-sm text-brand-gray mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="font-syne font-semibold text-navy mb-2">Recent Activity</h3>
        <p className="text-brand-gray text-sm">No recent activity yet. Start by adding contacts or deals.</p>
      </div>
    </div>
  )
}
