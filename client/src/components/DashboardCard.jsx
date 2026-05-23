import React from 'react'

export default function DashboardCard({ title, value, subtitle, icon, color = 'teal', trend }) {
  return (
    <div className="bg-white rounded-lg sm:rounded-xl shadow-sm p-3 sm:p-5 border-l-4" style={{ borderColor: `var(--color-${color})` }}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] sm:text-xs font-medium text-brand-gray uppercase tracking-wider truncate">{title}</p>
          <p className="text-lg sm:text-2xl font-bold text-navy mt-0.5 sm:mt-1.5 truncate leading-tight">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="text-[9px] sm:text-xs text-brand-gray mt-0.5 sm:mt-1.5 truncate">{subtitle}</p>
          )}
          {trend && (
            <p className={`text-[10px] sm:text-xs font-medium mt-1 ${trend.direction === 'up' ? 'text-green-600' : 'text-red-600'}`}>
              {trend.direction === 'up' ? '↑' : '↓'} {trend.value}% from last month
            </p>
          )}
        </div>
        {icon && (
          <div className="text-lg sm:text-2xl lg:text-3xl flex-shrink-0 ml-2" style={{ opacity: 0.2 }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
