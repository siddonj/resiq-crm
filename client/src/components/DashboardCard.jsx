import React from 'react'

export default function DashboardCard({ title, value, subtitle, icon, color = 'teal', trend }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border-l-4" style={{ borderColor: `var(--color-${color})` }}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] sm:text-xs font-medium text-brand-gray uppercase tracking-wide truncate">{title}</p>
          <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-navy mt-1 sm:mt-2 truncate">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="text-[10px] sm:text-xs text-brand-gray mt-1 sm:mt-2 truncate">{subtitle}</p>
          )}
          {trend && (
            <p className={`text-xs font-medium mt-2 ${trend.direction === 'up' ? 'text-green-600' : 'text-red-600'}`}>
              {trend.direction === 'up' ? '↑' : '↓'} {trend.value}% from last month
            </p>
          )}
        </div>
        {icon && (
          <div className={`text-3xl`} style={{ opacity: 0.2 }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
