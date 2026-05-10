import { formatCurrency, toInt } from '../utils/formatting.jsx'

export default function ForecastPanel({
  forecastPeriod,
  setForecastPeriod,
  loadingForecast,
  forecastBuckets,
  forecastProgress,
  goalForm,
  setGoalForm,
  busyKey,
  handleSaveGoal,
  forecastGoals,
  forecastSummary,
  forecastGap,
  loadingAttribution,
  attributionSummary,
  attributionSources,
  attributionOverview,
  attributionSequences,
  attributionPersonas,
}) {
  return (
    <>
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Forecast + Goals</h3>
            <p className="text-xs text-brand-gray mt-0.5">
              Commit, best-case, and closed forecast buckets with period goal tracking.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setForecastPeriod('weekly')}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                forecastPeriod === 'weekly'
                  ? 'bg-teal text-white border-teal'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setForecastPeriod('monthly')}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                forecastPeriod === 'monthly'
                  ? 'bg-teal text-white border-teal'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Monthly
            </button>
          </div>
        </div>

        {loadingForecast ? (
          <p className="text-sm text-brand-gray">Loading forecast summary...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-brand-gray">Closed Bucket</p>
                <p className="text-xl font-bold text-navy">{formatCurrency(forecastBuckets.closed?.value)}</p>
                <p className="text-xs text-brand-gray">{toInt(forecastBuckets.closed?.count)} leads</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-brand-gray">Commit Bucket</p>
                <p className="text-xl font-bold text-navy">{formatCurrency(forecastBuckets.commit?.value)}</p>
                <p className="text-xs text-brand-gray">{toInt(forecastBuckets.commit?.count)} leads</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-brand-gray">Best-Case Bucket</p>
                <p className="text-xl font-bold text-navy">{formatCurrency(forecastBuckets.bestCase?.value)}</p>
                <p className="text-xs text-brand-gray">{toInt(forecastBuckets.bestCase?.count)} leads</p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-lg p-4">
              <p className="text-xs text-brand-gray">Total Forecast Value</p>
              <p className="text-2xl font-bold text-navy">{formatCurrency(forecastBuckets.totalForecastValue)}</p>
              {forecastProgress ? (
                <p className="text-xs text-brand-gray mt-1">
                  {toInt(forecastProgress.elapsedDays)} of {toInt(forecastProgress.totalDays)} days elapsed
                </p>
              ) : null}
            </div>

            <form onSubmit={handleSaveGoal} className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input
                type="number"
                min="0"
                value={goalForm.targetMeetings}
                onChange={(event) => setGoalForm((prev) => ({ ...prev, targetMeetings: toInt(event.target.value) }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Target meetings"
              />
              <input
                type="number"
                min="0"
                value={goalForm.targetOpportunities}
                onChange={(event) =>
                  setGoalForm((prev) => ({ ...prev, targetOpportunities: toInt(event.target.value) }))
                }
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Target opportunities"
              />
              <input
                type="number"
                min="0"
                value={goalForm.targetRevenue}
                onChange={(event) => setGoalForm((prev) => ({ ...prev, targetRevenue: toInt(event.target.value) }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Target revenue"
              />
              <input
                type="text"
                value={goalForm.notes}
                onChange={(event) => setGoalForm((prev) => ({ ...prev, notes: event.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Goal notes"
              />
              <button
                type="submit"
                disabled={busyKey === `goal-save-${forecastPeriod}`}
                className="bg-navy text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy/90 disabled:opacity-60"
              >
                {busyKey === `goal-save-${forecastPeriod}` ? 'Saving...' : 'Save Goals'}
              </button>
            </form>

            {forecastGoals ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-brand-gray">
                    Meetings: {toInt(forecastSummary?.projected?.meetings)} / {toInt(forecastGoals.targetMeetings)}
                  </p>
                  <p
                    className={`text-xs mt-1 ${
                      (forecastGap?.meetingsGap || 0) <= 0 ? 'text-emerald-600' : 'text-amber-700'
                    }`}
                  >
                    Gap: {toInt(forecastGap?.meetingsGap)}
                  </p>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-brand-gray">
                    Opportunities: {toInt(forecastSummary?.projected?.opportunities)} /{' '}
                    {toInt(forecastGoals.targetOpportunities)}
                  </p>
                  <p
                    className={`text-xs mt-1 ${
                      (forecastGap?.opportunitiesGap || 0) <= 0 ? 'text-emerald-600' : 'text-amber-700'
                    }`}
                  >
                    Gap: {toInt(forecastGap?.opportunitiesGap)}
                  </p>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-3">
                  <p className="text-xs text-brand-gray">
                    Revenue: {formatCurrency(forecastSummary?.projected?.revenue)} /{' '}
                    {formatCurrency(forecastGoals.targetRevenue)}
                  </p>
                  <p
                    className={`text-xs mt-1 ${
                      (forecastGap?.revenueGap || 0) <= 0 ? 'text-emerald-600' : 'text-amber-700'
                    }`}
                  >
                    Gap: {formatCurrency(forecastGap?.revenueGap)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-brand-gray">Set goals for this period to unlock gap-to-goal tracking.</p>
            )}
          </>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy">Attribution + Source ROI</h3>
            <p className="text-xs text-brand-gray mt-0.5">
              Source to sequence to meeting to opportunity lineage for the {forecastPeriod} window.
            </p>
          </div>
          {attributionSummary?.period ? (
            <p className="text-xs text-brand-gray">
              {attributionSummary.period.start} to {attributionSummary.period.end}
            </p>
          ) : null}
        </div>

        {loadingAttribution ? (
          <p className="text-sm text-brand-gray">Loading attribution summary...</p>
        ) : attributionSources.length === 0 ? (
          <p className="text-sm text-brand-gray">No attribution events yet for this period.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Imported</p>
                <p className="text-lg font-bold text-navy">{toInt(attributionOverview.importedLeads)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Contacted</p>
                <p className="text-lg font-bold text-navy">{toInt(attributionOverview.contactedLeads)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Meetings</p>
                <p className="text-lg font-bold text-navy">{toInt(attributionOverview.meetingLeads)}</p>
                <p className="text-xs text-brand-gray">{toInt(attributionOverview.meetingRateFromImported)}% from imported</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Opportunities</p>
                <p className="text-lg font-bold text-navy">{toInt(attributionOverview.opportunityLeads)}</p>
                <p className="text-xs text-brand-gray">
                  {toInt(attributionOverview.opportunityRateFromImported)}% from imported
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-brand-gray">Attributed Revenue</p>
                <p className="text-lg font-bold text-navy">{formatCurrency(attributionOverview.attributedRevenue)}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Imported</th>
                    <th className="py-2 pr-3">Meetings</th>
                    <th className="py-2 pr-3">Opportunities</th>
                    <th className="py-2 pr-3">Revenue</th>
                    <th className="py-2 pr-3">Opp %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {attributionSources.slice(0, 8).map((source) => (
                    <tr key={`${source.sourceType}-${source.sourceReference}`}>
                      <td className="py-2 pr-3">
                        <p className="font-semibold text-navy">{source.sourceType}</p>
                        <p className="text-xs text-brand-gray truncate max-w-[240px]">{source.sourceReference}</p>
                      </td>
                      <td className="py-2 pr-3">{toInt(source.importedLeads)}</td>
                      <td className="py-2 pr-3">{toInt(source.meetingLeads)}</td>
                      <td className="py-2 pr-3">{toInt(source.opportunityLeads)}</td>
                      <td className="py-2 pr-3">{formatCurrency(source.attributedRevenue)}</td>
                      <td className="py-2 pr-3">{toInt(source.opportunityRateFromImported)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs font-semibold text-navy mb-2">Top Sequences</p>
                {attributionSequences.length === 0 ? (
                  <p className="text-xs text-brand-gray">No sequence-attributed events yet.</p>
                ) : (
                  <div className="space-y-2">
                    {attributionSequences.slice(0, 5).map((sequence) => (
                      <div key={sequence.sequenceId} className="flex items-center justify-between gap-3 text-xs">
                        <p className="text-navy truncate">{sequence.sequenceName}</p>
                        <p className="text-brand-gray">
                          Opp {toInt(sequence.opportunityLeads)} | {formatCurrency(sequence.attributedRevenue)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="border border-gray-100 rounded-lg p-3">
                <p className="text-xs font-semibold text-navy mb-2">Top Personas</p>
                {attributionPersonas.length === 0 ? (
                  <p className="text-xs text-brand-gray">No persona attribution yet.</p>
                ) : (
                  <div className="space-y-2">
                    {attributionPersonas.slice(0, 5).map((persona) => (
                      <div key={persona.persona} className="flex items-center justify-between gap-3 text-xs">
                        <p className="text-navy">{persona.persona}</p>
                        <p className="text-brand-gray">
                          Opp {toInt(persona.opportunityLeads)} | {formatCurrency(persona.attributedRevenue)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
