import { renderStatusBadge, toInt } from '../utils/formatting.jsx'

export default function SequenceManager({
  sequences,
  sequenceEnrollments,
  loadingSequences,
  loadingSequenceEnrollments,
  busyKey,
  handleSequenceStateChange,
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-navy">Sequence Control Center</h3>
          <p className="text-xs text-brand-gray mt-0.5">
            Enforce one active sequence per lead with pause, resume, and stop controls.
          </p>
        </div>
        <div className="text-xs text-brand-gray">
          Open enrollments:{' '}
          {sequenceEnrollments.filter((item) => item.status === 'active' || item.status === 'paused').length}
        </div>
      </div>

      {loadingSequences || loadingSequenceEnrollments ? (
        <p className="text-sm text-brand-gray">Loading sequence control data...</p>
      ) : sequences.length === 0 ? (
        <p className="text-sm text-brand-gray">
          No sequences found. Create one in the Sequences page before enrolling leads.
        </p>
      ) : sequenceEnrollments.length === 0 ? (
        <p className="text-sm text-brand-gray">No sequence enrollments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                <th className="py-2 pr-3">Lead</th>
                <th className="py-2 pr-3">Sequence</th>
                <th className="py-2 pr-3">State</th>
                <th className="py-2 pr-3">Step</th>
                <th className="py-2 pr-3">Updated</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sequenceEnrollments.map((enrollment) => (
                <tr key={enrollment.id}>
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-navy">{enrollment.lead_name}</p>
                    <p className="text-xs text-brand-gray">{enrollment.lead_email || 'No email'}</p>
                  </td>
                  <td className="py-3 pr-3">{enrollment.sequence_name}</td>
                  <td className="py-3 pr-3">{renderStatusBadge(enrollment.status)}</td>
                  <td className="py-3 pr-3 text-xs text-gray-700">
                    {toInt(enrollment.current_step)} / {toInt(enrollment.total_steps)}
                  </td>
                  <td className="py-3 pr-3 text-xs text-brand-gray">
                    {enrollment.updated_at ? new Date(enrollment.updated_at).toLocaleString() : '-'}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-2">
                      {enrollment.status === 'active' && (
                        <button
                          onClick={() => handleSequenceStateChange(enrollment, 'paused')}
                          disabled={busyKey === `sequence-state-${enrollment.id}-paused`}
                          className="text-xs border border-amber-200 text-amber-700 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-60"
                        >
                          Pause
                        </button>
                      )}
                      {enrollment.status === 'paused' && (
                        <button
                          onClick={() => handleSequenceStateChange(enrollment, 'active')}
                          disabled={busyKey === `sequence-state-${enrollment.id}-active`}
                          className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                        >
                          Resume
                        </button>
                      )}
                      {(enrollment.status === 'active' || enrollment.status === 'paused') && (
                        <button
                          onClick={() => handleSequenceStateChange(enrollment, 'stopped')}
                          disabled={busyKey === `sequence-state-${enrollment.id}-stopped`}
                          className="text-xs border border-rose-200 text-rose-700 rounded px-2 py-1 hover:bg-rose-50 disabled:opacity-60"
                        >
                          Stop
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
