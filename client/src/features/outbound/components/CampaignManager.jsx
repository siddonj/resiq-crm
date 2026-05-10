import { renderStatusBadge, toInt } from '../utils/formatting.jsx'

export default function CampaignManager({
  campaigns,
  campaignForm,
  setCampaignForm,
  leads,
  loadingCampaigns,
  busyKey,
  handleCreateCampaign,
  handleCampaignStatus,
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <h3 className="text-sm font-semibold text-navy">Campaign Runs</h3>
      <form onSubmit={handleCreateCampaign} className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <input
          type="text"
          value={campaignForm.name}
          onChange={(event) => setCampaignForm((prev) => ({ ...prev, name: event.target.value }))}
          placeholder="Campaign name"
          className="md:col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={campaignForm.includeEmail}
            onChange={(event) => setCampaignForm((prev) => ({ ...prev, includeEmail: event.target.checked }))}
          />
          Email
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={campaignForm.includeLinkedIn}
            onChange={(event) => setCampaignForm((prev) => ({ ...prev, includeLinkedIn: event.target.checked }))}
          />
          LinkedIn
        </label>
        <button
          type="submit"
          disabled={busyKey === 'campaign-create'}
          className="bg-navy text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy/90 disabled:opacity-60"
        >
          {busyKey === 'campaign-create' ? 'Creating...' : `Create (${leads.length} Leads)`}
        </button>
      </form>

      {loadingCampaigns ? (
        <p className="text-sm text-brand-gray">Loading campaigns...</p>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-brand-gray">No campaigns yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Channels</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Members</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-navy">{campaign.name}</p>
                    <p className="text-xs text-brand-gray">
                      Created {new Date(campaign.created_at).toLocaleDateString()}
                    </p>
                  </td>
                  <td className="py-3 pr-3 text-xs text-gray-700">
                    {(Array.isArray(campaign.channels) ? campaign.channels : []).join(', ')}
                  </td>
                  <td className="py-3 pr-3">{renderStatusBadge(campaign.status)}</td>
                  <td className="py-3 pr-3 text-xs text-gray-700">
                    {toInt(campaign.member_count)} total | {toInt(campaign.engaged_count)} engaged
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-2">
                      {campaign.status === 'draft' || campaign.status === 'paused' ? (
                        <button
                          onClick={() => handleCampaignStatus(campaign.id, 'active')}
                          disabled={busyKey === `campaign-status-${campaign.id}-active`}
                          className="text-xs border border-emerald-200 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-60"
                        >
                          Activate
                        </button>
                      ) : null}
                      {campaign.status === 'active' ? (
                        <button
                          onClick={() => handleCampaignStatus(campaign.id, 'paused')}
                          disabled={busyKey === `campaign-status-${campaign.id}-paused`}
                          className="text-xs border border-amber-200 text-amber-700 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-60"
                        >
                          Pause
                        </button>
                      ) : null}
                      {campaign.status !== 'completed' && campaign.status !== 'archived' ? (
                        <button
                          onClick={() => handleCampaignStatus(campaign.id, 'completed')}
                          disabled={busyKey === `campaign-status-${campaign.id}-completed`}
                          className="text-xs border border-blue-200 text-blue-700 rounded px-2 py-1 hover:bg-blue-50 disabled:opacity-60"
                        >
                          Complete
                        </button>
                      ) : null}
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
