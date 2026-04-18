const COLOR_MAP = {
  teal: 'bg-teal/10 text-teal',
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
  gray: 'bg-gray-100 text-gray-500',
}

export default function DashboardCard({ title, value, subtitle, icon, color = 'teal' }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-brand-gray">{title}</span>
        <span className={`text-lg p-1.5 rounded-lg ${COLOR_MAP[color] || COLOR_MAP.teal}`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-navy">{value}</p>
      {subtitle && <p className="text-xs text-brand-gray mt-1">{subtitle}</p>}
    </div>
  )
}
