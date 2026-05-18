import { toInt, renderStatusBadge, MULTIFAMILY_OBJECT_TYPES } from '../utils/formatting.jsx';

export default function LeadTable({
  leads,
  selectedLeadMap,
  onToggleLeadSelected,
  onToggleSelectAllVisibleLeads,
  allVisibleLeadsSelected,
  sequences,
  openEnrollmentByLead,
  selectedSequenceByLead,
  onSelectSequenceByLead,
  multifamilyObjects,
  multifamilyObjectsByType,
  leadObjectSelection,
  onLeadObjectSelectionChange,
  busyKey,
  onRescoreLead,
  onEnrollLeadInSequence,
  onAssociateObjectToLead,
  onAddLeadToContact,
  onGenerateDraft,
  onSuppression,
  onDeleteLead,
}) {
  if (!leads || leads.length === 0) {
    return <div className="text-sm text-brand-gray">No leads found with the current filters.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
            <th className="py-2 pr-3">
              <input
                type="checkbox"
                checked={allVisibleLeadsSelected}
                onChange={(event) => onToggleSelectAllVisibleLeads(event.target.checked)}
              />
            </th>
            <th className="py-2 pr-3">Lead</th>
            <th className="py-2 pr-3">Company</th>
            <th className="py-2 pr-3">Score</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td className="py-3 pr-3 align-top">
                <input
                  type="checkbox"
                  checked={Boolean(selectedLeadMap[lead.id])}
                  onChange={(event) => onToggleLeadSelected(lead.id, event.target.checked)}
                />
              </td>
              <td className="py-3 pr-3">
                <p className="font-semibold text-navy">{lead.name}</p>
                <p className="text-xs text-brand-gray">{lead.email || 'No email'}</p>
                {toInt(lead.open_issue_count) > 0 ? (
                  <p className="text-xs text-amber-700 mt-1">
                    Data quality issues: {toInt(lead.open_issue_count)}
                    {toInt(lead.open_blocking_issue_count) > 0 ? ` (${toInt(lead.open_blocking_issue_count)} blocking)` : ''}
                  </p>
                ) : null}
              </td>
              <td className="py-3 pr-3">
                <p className="text-navy">{lead.company || 'Unknown company'}</p>
                <p className="text-xs text-brand-gray">{lead.title || 'No title'}</p>
              </td>
              <td className="py-3 pr-3">
                <p className="font-semibold text-navy">{toInt(lead.total_score)}</p>
                <p className="text-xs text-brand-gray">
                  Fit {toInt(lead.fit_score)} | Intent {toInt(lead.intent_score)}
                </p>
              </td>
              <td className="py-3 pr-3">{renderStatusBadge(lead.status)}</td>
              <td className="py-3 pr-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onRescoreLead(lead.id)}
                    disabled={busyKey === `score-${lead.id}`}
                    className="text-xs border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-60"
                  >
                    Rescore
                  </button>
                  {sequences.length > 0 && (
                    <>
                      <select
                        value={selectedSequenceByLead[lead.id] || ''}
                        onChange={(event) =>
                          onSelectSequenceByLead(lead.id, event.target.value)
                        }
                        className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700"
                      >
                        <option value="">Select sequence</option>
                        {sequences
                          .filter((sequence) => toInt(sequence.step_count) > 0)
                          .map((sequence) => (
                            <option key={sequence.id} value={sequence.id}>
                              {sequence.name}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={() => onEnrollLeadInSequence(lead.id)}
                        disabled={
                          busyKey === `enroll-sequence-${lead.id}` ||
                          !selectedSequenceByLead[lead.id] ||
                          Boolean(openEnrollmentByLead[lead.id]) ||
                          toInt(lead.open_blocking_issue_count) > 0
                        }
                        className="text-xs border border-indigo-200 text-indigo-700 rounded px-2 py-1 hover:bg-indigo-50 disabled:opacity-60"
                        title={
                          openEnrollmentByLead[lead.id]
                            ? `Already enrolled in ${openEnrollmentByLead[lead.id].sequence_name}`
                            : toInt(lead.open_blocking_issue_count) > 0
                            ? 'Fix blocking data quality issues before enrollment.'
                            : ''
                        }
                      >
                        {openEnrollmentByLead[lead.id]
                          ? 'Enrolled'
                          : toInt(lead.open_blocking_issue_count) > 0
                          ? 'Blocked'
                          : 'Enroll'}
                      </button>
                    </>
                  )}
                  {multifamilyObjects.length > 0 && (
                    <>
                      <select
                        value={leadObjectSelection[lead.id]?.objectType || 'portfolio'}
                        onChange={(event) =>
                          onLeadObjectSelectionChange(lead.id, { objectType: event.target.value, objectId: '' })
                        }
                        className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700"
                      >
                        {MULTIFAMILY_OBJECT_TYPES.map((typeOption) => (
                          <option key={typeOption.value} value={typeOption.value}>
                            {typeOption.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={leadObjectSelection[lead.id]?.objectId || ''}
                        onChange={(event) =>
                          onLeadObjectSelectionChange(lead.id, {
                            objectType: leadObjectSelection[lead.id]?.objectType || 'portfolio',
                            objectId: event.target.value,
                          })
                        }
                        className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700"
                      >
                        <option value="">Select object</option>
                        {(multifamilyObjectsByType[leadObjectSelection[lead.id]?.objectType || 'portfolio'] || []).map((object) => (
                          <option key={object.id} value={object.id}>
                            {object.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => onAssociateObjectToLead(lead.id)}
                        disabled={
                          busyKey === `multifamily-associate-${lead.id}` ||
                          !Boolean(leadObjectSelection[lead.id]?.objectId)
                        }
                        className="text-xs border border-slate-200 text-slate-700 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Tag
                      </button>
                    </>
                  )}
                  {onAddLeadToContact && (
                    <button
                      onClick={() => onAddLeadToContact(lead.id)}
                      disabled={busyKey === `contact-${lead.id}` || !lead.email}
                      className="text-xs border border-teal/40 text-teal rounded px-2 py-1 hover:bg-teal/5 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Add to Contacts
                    </button>
                  )}
                  <button
                    onClick={() => onGenerateDraft(lead, 'email')}
                    disabled={busyKey === `draft-email-${lead.id}`}
                    className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-60"
                  >
                    Draft Email
                  </button>
                  <button
                    onClick={() => onGenerateDraft(lead, 'linkedin')}
                    disabled={busyKey === `draft-linkedin-${lead.id}`}
                    className="text-xs border border-amber-200 text-amber-700 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-60"
                  >
                    Draft LinkedIn
                  </button>
                  {lead.status === 'suppressed' ? (
                    <button
                      onClick={() => onSuppression(lead, false)}
                      disabled={busyKey === `suppression-${lead.id}-off`}
                      className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                    >
                      Unsuppress
                    </button>
                  ) : (
                    <button
                      onClick={() => onSuppression(lead, true)}
                      disabled={busyKey === `suppression-${lead.id}-on`}
                      className="text-xs border border-rose-200 text-rose-700 rounded px-2 py-1 hover:bg-rose-50 disabled:opacity-60"
                    >
                      Suppress
                    </button>
                  )}
                  <button
                    onClick={() => onDeleteLead(lead.id)}
                    disabled={busyKey === `delete-lead-${lead.id}`}
                    className="text-xs border border-red-200 text-red-700 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
