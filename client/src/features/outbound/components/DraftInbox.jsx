import { toInt } from '../utils/formatting.jsx'

export default function DraftInbox({
  draftInbox,
  draftInboxCounts,
  loadingDraftInbox,
  busyKey,
  refreshDraftInbox,
  handleApproveDraft,
  handleSendEmailDraft,
  handleCompleteLinkedInTask,
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-navy">Draft Inbox</h3>
          <p className="text-xs text-brand-gray mt-0.5">Persistent draft queue across sessions and devices.</p>
        </div>
        <button
          onClick={refreshDraftInbox}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50"
        >
          Refresh Inbox
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Total Drafts</p>
          <p className="text-lg font-bold text-navy">{toInt(draftInboxCounts.total_count)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Drafted</p>
          <p className="text-lg font-bold text-navy">{toInt(draftInboxCounts.drafted_count)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Approved</p>
          <p className="text-lg font-bold text-indigo-700">{toInt(draftInboxCounts.approved_count)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Sent</p>
          <p className="text-lg font-bold text-emerald-700">{toInt(draftInboxCounts.sent_count)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Pending LinkedIn</p>
          <p className="text-lg font-bold text-amber-700">{toInt(draftInboxCounts.pending_linkedin_count)}</p>
        </div>
      </div>

      {loadingDraftInbox ? (
        <p className="text-sm text-brand-gray">Loading draft inbox...</p>
      ) : draftInbox.length === 0 ? (
        <p className="text-sm text-brand-gray">No drafts in inbox yet.</p>
      ) : (
        <div className="space-y-3">
          {draftInbox.slice(0, 30).map((draft) => (
            <div key={draft.id} className="border border-gray-100 rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-navy">
                    {draft.channel === 'linkedin' ? 'LinkedIn' : 'Email'} draft for {draft.lead?.name || 'Unknown lead'}
                  </p>
                  <p className="text-xs text-brand-gray">
                    {draft.status} {draft.channel === 'linkedin' && draft.linkedinTask ? `| Task ${draft.linkedinTask.status}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {draft.status === 'drafted' && (
                    <button
                      onClick={() => handleApproveDraft(draft.id)}
                      disabled={busyKey === `approve-${draft.id}`}
                      className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                    >
                      Approve
                    </button>
                  )}
                  {draft.channel === 'email' && draft.status === 'approved' && (
                    <button
                      onClick={() => handleSendEmailDraft(draft)}
                      disabled={busyKey === `send-email-${draft.id}`}
                      className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-60"
                    >
                      Mark Sent
                    </button>
                  )}
                  {draft.channel === 'linkedin' && draft.status === 'approved' && draft.linkedinTask?.status !== 'completed' && (
                    <button
                      onClick={() => handleCompleteLinkedInTask(draft.linkedinTask)}
                      disabled={busyKey === `complete-task-${draft.linkedinTask?.id}`}
                      className="text-xs border border-amber-200 text-amber-700 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-60"
                    >
                      Complete Task
                    </button>
                  )}
                </div>
              </div>
              {draft.subject && <p className="text-xs text-brand-gray mt-2">Subject: {draft.subject}</p>}
              <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap line-clamp-3">{draft.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
