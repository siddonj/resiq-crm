import { toInt } from '../utils/formatting.jsx'

export default function DataQualityPanel({
  dataQualityIssues,
  dataQualityMergeOperations,
  dataQualityStatusFilter,
  setDataQualityStatusFilter,
  dataQualityOpenCount,
  dataQualityOpenBlockingCount,
  dataQualityResolvedCount,
  dataQualityMergeCount30d,
  loadingDataQuality,
  loadingDataQualityMergeOperations,
  busyKey,
  refreshDataQualityIssues,
  refreshDataQualityMergeOperations,
  handleDataQualityIssueStatus,
  handleMergeDuplicateIssue,
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-navy">Data Quality Command Center</h3>
          <p className="text-xs text-brand-gray mt-0.5">
            Duplicate queue, stale records, and pre-enrollment required-field guardrails.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={dataQualityStatusFilter}
            onChange={(event) => setDataQualityStatusFilter(event.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700"
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <button
            onClick={refreshDataQualityIssues}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50"
          >
            Refresh Queue
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Open Issues</p>
          <p className="text-lg font-bold text-navy">{dataQualityOpenCount}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Blocking Enrollment</p>
          <p className="text-lg font-bold text-rose-700">{dataQualityOpenBlockingCount}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Resolved</p>
          <p className="text-lg font-bold text-emerald-700">{dataQualityResolvedCount}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Merges (30d)</p>
          <p className="text-lg font-bold text-indigo-700">{dataQualityMergeCount30d}</p>
        </div>
      </div>

      {loadingDataQuality ? (
        <p className="text-sm text-brand-gray">Loading data quality issues...</p>
      ) : dataQualityIssues.length === 0 ? (
        <p className="text-sm text-brand-gray">No issues for this filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                <th className="py-2 pr-3">Issue</th>
                <th className="py-2 pr-3">Lead</th>
                <th className="py-2 pr-3">Severity</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {dataQualityIssues.map((issue) => (
                <tr key={issue.id}>
                  <td className="py-2 pr-3">
                    <p className="font-semibold text-navy">{issue.issueType}</p>
                    <p className="text-xs text-brand-gray">{issue.details?.message || 'No details'}</p>
                  </td>
                  <td className="py-2 pr-3">
                    {issue.lead ? (
                      <>
                        <p className="text-navy">{issue.lead.name}</p>
                        <p className="text-xs text-brand-gray">{issue.lead.email || issue.lead.company || 'No identifier'}</p>
                      </>
                    ) : (
                      <span className="text-xs text-brand-gray">No lead attached</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        issue.severity === 'high'
                          ? 'bg-rose-100 text-rose-700'
                          : issue.severity === 'medium'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {issue.severity}
                    </span>
                    {issue.isBlocking ? <p className="text-[11px] text-rose-700 mt-1">Blocks enrollment</p> : null}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-700">{issue.status}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-2">
                      {issue.status !== 'resolved' && (
                        <button
                          onClick={() => handleDataQualityIssueStatus(issue.id, 'resolved')}
                          disabled={busyKey === `data-quality-${issue.id}-resolved`}
                          className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                        >
                          Resolve
                        </button>
                      )}
                      {issue.status !== 'dismissed' && (
                        <button
                          onClick={() => handleDataQualityIssueStatus(issue.id, 'dismissed')}
                          disabled={busyKey === `data-quality-${issue.id}-dismissed`}
                          className="text-xs border border-gray-200 text-gray-700 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-60"
                        >
                          Dismiss
                        </button>
                      )}
                      {issue.status !== 'open' && (
                        <button
                          onClick={() => handleDataQualityIssueStatus(issue.id, 'open')}
                          disabled={busyKey === `data-quality-${issue.id}-open`}
                          className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-60"
                        >
                          Reopen
                        </button>
                      )}
                      {issue.issueType === 'potential_duplicate' && issue.status === 'open' && (
                        <button
                          onClick={() => handleMergeDuplicateIssue(issue)}
                          disabled={busyKey === `data-quality-merge-${issue.id}`}
                          className="text-xs border border-indigo-200 text-indigo-700 rounded px-2 py-1 hover:bg-indigo-50 disabled:opacity-60"
                        >
                          {busyKey === `data-quality-merge-${issue.id}` ? 'Merging...' : 'Merge Group'}
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

      <div className="border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-navy">Recent Merge Operations</p>
          <button
            onClick={refreshDataQualityMergeOperations}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 hover:bg-gray-50"
          >
            Refresh Merges
          </button>
        </div>
        {loadingDataQualityMergeOperations ? (
          <p className="text-xs text-brand-gray mt-2">Loading merge operations...</p>
        ) : dataQualityMergeOperations.length === 0 ? (
          <p className="text-xs text-brand-gray mt-2">No merge operations yet.</p>
        ) : (
          <div className="mt-2 space-y-1">
            {dataQualityMergeOperations.slice(0, 6).map((operation) => (
              <p key={operation.id} className="text-xs text-brand-gray">
                <span className="font-semibold text-navy">{operation.primaryLead?.name || operation.primaryLeadId || 'Primary lead'}</span>
                {` merged ${toInt(operation.mergedLeadCount)} lead(s)`}
                {operation.createdAt ? ` • ${new Date(operation.createdAt).toLocaleString()}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
