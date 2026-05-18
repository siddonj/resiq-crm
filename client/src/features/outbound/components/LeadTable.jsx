import { useState } from 'react'
import { toInt, renderStatusBadge, MULTIFAMILY_OBJECT_TYPES } from '../utils/formatting.jsx'

function MoreDropdown({ lead, sequences, openEnrollmentByLead, selectedSequenceByLead,
  onSelectSequenceByLead, multifamilyObjects, multifamilyObjectsByType,
  leadObjectSelection, onLeadObjectSelectionChange, busyKey, onRescoreLead,
  onEnrollLeadInSequence, onAssociateObjectToLead, onAddLeadToContact,
  onSuppression, onDeleteLead }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 text-gray-500"
      >
        More
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px]">
            <button
              onClick={() => { onRescoreLead(lead.id); setOpen(false) }}
              disabled={busyKey === `score-${lead.id}`}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Rescore
            </button>

            {sequences.length > 0 && (
              <div className="px-3 py-1.5 space-y-1">
                <select
                  value={selectedSequenceByLead[lead.id] || ''}
                  onChange={(e) => onSelectSequenceByLead(lead.id, e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-700"
                >
                  <option value="">Select sequence</option>
                  {sequences
                    .filter((s) => toInt(s.step_count) > 0)
                    .map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
                <button
                  onClick={() => { onEnrollLeadInSequence(lead.id); setOpen(false) }}
                  disabled={busyKey === `enroll-sequence-${lead.id}` || !selectedSequenceByLead[lead.id] || Boolean(openEnrollmentByLead[lead.id]) || toInt(lead.open_blocking_issue_count) > 0}
                  className="w-full text-left text-xs text-indigo-700 hover:bg-indigo-50 rounded px-1.5 py-1 disabled:opacity-60"
                >
                  {openEnrollmentByLead[lead.id] ? `Enrolled in ${openEnrollmentByLead[lead.id].sequence_name || 'sequence'}` : toInt(lead.open_blocking_issue_count) > 0 ? 'Blocked by data issues' : 'Enroll'}
                </button>
              </div>
            )}

            {multifamilyObjects.length > 0 && (
              <div className="px-3 py-1.5 space-y-1 border-t border-gray-100">
                <div className="flex gap-1">
                  <select
                    value={leadObjectSelection[lead.id]?.objectType || 'portfolio'}
                    onChange={(e) => onLeadObjectSelectionChange(lead.id, { objectType: e.target.value, objectId: '' })}
                    className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-700"
                  >
                    {MULTIFAMILY_OBJECT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <select
                    value={leadObjectSelection[lead.id]?.objectId || ''}
                    onChange={(e) => onLeadObjectSelectionChange(lead.id, { objectType: leadObjectSelection[lead.id]?.objectType || 'portfolio', objectId: e.target.value })}
                    className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-700"
                  >
                    <option value="">Select</option>
                    {(multifamilyObjectsByType[leadObjectSelection[lead.id]?.objectType || 'portfolio'] || []).map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => { onAssociateObjectToLead(lead.id); setOpen(false) }}
                  disabled={busyKey === `multifamily-associate-${lead.id}` || !leadObjectSelection[lead.id]?.objectId}
                  className="w-full text-left text-xs text-slate-700 hover:bg-slate-50 rounded px-1.5 py-1 disabled:opacity-60"
                >
                  Tag
                </button>
              </div>
            )}

            {onAddLeadToContact && (
              <button
                onClick={() => { onAddLeadToContact(lead.id); setOpen(false) }}
                disabled={busyKey === `contact-${lead.id}` || !lead.email}
                className="w-full text-left px-3 py-1.5 text-xs text-teal hover:bg-teal/5 disabled:opacity-40"
              >
                Add to Contacts
              </button>
            )}

            <div className="border-t border-gray-100">
              {lead.status === 'suppressed' ? (
                <button
                  onClick={() => { onSuppression(lead, false); setOpen(false) }}
                  disabled={busyKey === `suppression-${lead.id}-off`}
                  className="w-full text-left px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                >
                  Unsuppress
                </button>
              ) : (
                <button
                  onClick={() => { onSuppression(lead, true); setOpen(false) }}
                  disabled={busyKey === `suppression-${lead.id}-on`}
                  className="w-full text-left px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                >
                  Suppress
                </button>
              )}
              <button
                onClick={() => { onDeleteLead(lead.id); setOpen(false) }}
                disabled={busyKey === `delete-lead-${lead.id}`}
                className="w-full text-left px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        </>
      )}
</div>
  )
}
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
    return <div className="text-sm text-brand-gray">No leads found with the current filters.</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
            <th className="py-2 pr-3 w-8">
              <input
                type="checkbox"
                checked={allVisibleLeadsSelected}
                onChange={(e) => onToggleSelectAllVisibleLeads(e.target.checked)}
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
            <tr key={lead.id} className="hover:bg-gray-50/50">
              <td className="py-3 pr-3 align-top">
                <input
                  type="checkbox"
                  checked={Boolean(selectedLeadMap[lead.id])}
                  onChange={(e) => onToggleLeadSelected(lead.id, e.target.checked)}
                />
              </td>
              <td className="py-3 pr-3">
                <p className="font-semibold text-navy">{lead.name}</p>
                <p className="text-xs text-brand-gray">{lead.email || 'No email'}</p>
                {toInt(lead.open_issue_count) > 0 && (
                  <p className="text-xs text-amber-700 mt-1">
                    Issues: {toInt(lead.open_issue_count)}
                    {toInt(lead.open_blocking_issue_count) > 0 && ` (${toInt(lead.open_blocking_issue_count)} blocking)`}
                  </p>
                )}
              </td>
              <td className="py-3 pr-3">
                <p className="text-navy">{lead.company || 'Unknown company'}</p>
                <p className="text-xs text-brand-gray">{lead.title || 'No title'}</p>
              </td>
              <td className="py-3 pr-3">
                <p className="font-semibold text-navy">{toInt(lead.total_score)}</p>
                <p className="text-xs text-brand-gray">Fit {toInt(lead.fit_score)} | Intent {toInt(lead.intent_score)}</p>
              </td>
              <td className="py-3 pr-3">{renderStatusBadge(lead.status)}</td>
              <td className="py-3 pr-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => onGenerateDraft(lead, 'email')}
                    disabled={busyKey === `draft-email-${lead.id}`}
                    className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1.5 hover:bg-blue-50 disabled:opacity-60 font-medium"
                  >
                    Draft Email
                  </button>
                  <button
                    onClick={() => onGenerateDraft(lead, 'linkedin')}
                    disabled={busyKey === `draft-linkedin-${lead.id}`}
                    className="text-xs border border-amber-200 text-amber-700 rounded px-2 py-1.5 hover:bg-amber-50 disabled:opacity-60 font-medium"
                  >
                    Draft LinkedIn
                  </button>
                  {openEnrollmentByLead[lead.id] && (
                    <span className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-1">
                      {openEnrollmentByLead[lead.id].sequence_name || 'Enrolled'}
                    </span>
                  )}
                  <MoreDropdown
                    lead={lead}
                    sequences={sequences}
                    openEnrollmentByLead={openEnrollmentByLead}
                    selectedSequenceByLead={selectedSequenceByLead}
                    onSelectSequenceByLead={onSelectSequenceByLead}
                    multifamilyObjects={multifamilyObjects}
                    multifamilyObjectsByType={multifamilyObjectsByType}
                    leadObjectSelection={leadObjectSelection}
                    onLeadObjectSelectionChange={onLeadObjectSelectionChange}
                    busyKey={busyKey}
                    onRescoreLead={onRescoreLead}
                    onEnrollLeadInSequence={onEnrollLeadInSequence}
                    onAssociateObjectToLead={onAssociateObjectToLead}
                    onAddLeadToContact={onAddLeadToContact}
                    onSuppression={onSuppression}
                    onDeleteLead={onDeleteLead}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}