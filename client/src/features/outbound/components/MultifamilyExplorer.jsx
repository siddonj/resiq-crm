import { toInt } from '../utils/formatting.jsx'
import { MULTIFAMILY_OBJECT_TYPES } from '../utils/formatting.jsx'

const MULTIFAMILY_EXPLORER_ENTITY_TYPES = [
  { value: 'contact', label: 'Contacts' },
  { value: 'deal', label: 'Deals' },
  { value: 'company', label: 'Companies' },
]

export default function MultifamilyExplorer({
  multifamilyObjects,
  multifamilyObjectCounts,
  multifamilyAssociationCounts,
  multifamilyForm,
  setMultifamilyForm,
  multifamilyExplorer,
  setMultifamilyExplorer,
  multifamilyEntities,
  multifamilyEntitySelection,
  selectedMultifamilyEntityKeys,
  selectedMultifamilyObject,
  selectedObjectAssociations,
  objectAssociationsQuery,
  loadingMultifamily,
  loadingMultifamilyEntities,
  busyKey,
  refreshMultifamilyObjects,
  refreshMultifamilyEntities,
  fetchSelectedObjectAssociations,
  handleCreateMultifamilyObject,
  handleBulkAssociateExplorerEntities,
  handleToggleMultifamilyEntitySelection,
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-navy">Multifamily Object Explorer</h3>
          <p className="text-xs text-brand-gray mt-0.5">
            Manage portfolio, property, tech stack, and initiative objects with entity tagging workflows.
          </p>
        </div>
        <button
          onClick={() => {
            refreshMultifamilyObjects()
            refreshMultifamilyEntities()
            fetchSelectedObjectAssociations()
          }}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50"
        >
          Refresh Objects
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Portfolios</p>
          <p className="text-lg font-bold text-navy">{toInt(multifamilyObjectCounts.portfolio)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Properties</p>
          <p className="text-lg font-bold text-navy">{toInt(multifamilyObjectCounts.property)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Tech Stacks</p>
          <p className="text-lg font-bold text-navy">{toInt(multifamilyObjectCounts.tech_stack)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Initiatives</p>
          <p className="text-lg font-bold text-navy">{toInt(multifamilyObjectCounts.initiative)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Lead Associations</p>
          <p className="text-lg font-bold text-navy">{toInt(multifamilyAssociationCounts.outbound_lead)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Contact Associations</p>
          <p className="text-lg font-bold text-navy">{toInt(multifamilyAssociationCounts.contact)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Deal Associations</p>
          <p className="text-lg font-bold text-navy">{toInt(multifamilyAssociationCounts.deal)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-brand-gray">Company Associations</p>
          <p className="text-lg font-bold text-navy">{toInt(multifamilyAssociationCounts.company)}</p>
        </div>
      </div>

      <form onSubmit={handleCreateMultifamilyObject} className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <select
          value={multifamilyForm.objectType}
          onChange={(event) => setMultifamilyForm((prev) => ({ ...prev, objectType: event.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          {MULTIFAMILY_OBJECT_TYPES.map((typeOption) => (
            <option key={typeOption.value} value={typeOption.value}>
              {typeOption.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={multifamilyForm.name}
          onChange={(event) => setMultifamilyForm((prev) => ({ ...prev, name: event.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          placeholder="Object name"
        />
        <input
          type="text"
          value={multifamilyForm.description}
          onChange={(event) => setMultifamilyForm((prev) => ({ ...prev, description: event.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          placeholder="Description"
        />
        <button
          type="submit"
          disabled={busyKey === `multifamily-create-${multifamilyForm.objectType}`}
          className="bg-navy text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy/90 disabled:opacity-60"
        >
          {busyKey === `multifamily-create-${multifamilyForm.objectType}` ? 'Creating...' : 'Create Object'}
        </button>
      </form>

      {loadingMultifamily ? (
        <p className="text-sm text-brand-gray">Loading multifamily objects...</p>
      ) : multifamilyObjects.length === 0 ? (
        <p className="text-sm text-brand-gray">No multifamily objects created yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-brand-gray">
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Associations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {multifamilyObjects.slice(0, 20).map((object) => (
                <tr key={object.id}>
                  <td className="py-2 pr-3 text-xs text-gray-700">{object.objectType}</td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() =>
                        setMultifamilyExplorer((prev) => ({
                          ...prev,
                          objectId: object.id,
                        }))
                      }
                      className={`font-semibold ${
                        multifamilyExplorer.objectId === object.id ? 'text-teal underline' : 'text-navy hover:text-teal'
                      }`}
                    >
                      {object.name}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-xs text-brand-gray">{object.description || 'No description'}</td>
                  <td className="py-2 pr-3 text-xs text-brand-gray">
                    Leads {toInt(object.associationCounts?.outboundLead)} | Contacts {toInt(object.associationCounts?.contact)} |
                    Deals {toInt(object.associationCounts?.deal)} | Companies {toInt(object.associationCounts?.company)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border border-gray-100 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-brand-gray">Explorer Object</p>
          <select
            value={multifamilyExplorer.objectId}
            onChange={(event) =>
              setMultifamilyExplorer((prev) => ({
                ...prev,
                objectId: event.target.value,
              }))
            }
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs"
          >
            <option value="">Select object</option>
            {multifamilyObjects.map((object) => (
              <option key={object.id} value={object.id}>
                {object.name} ({object.objectType})
              </option>
            ))}
          </select>

          <select
            value={multifamilyExplorer.entityType}
            onChange={(event) =>
              setMultifamilyExplorer((prev) => ({
                ...prev,
                entityType: event.target.value,
              }))
            }
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs"
          >
            {MULTIFAMILY_EXPLORER_ENTITY_TYPES.map((entityType) => (
              <option key={entityType.value} value={entityType.value}>
                {entityType.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={multifamilyExplorer.search}
            onChange={(event) =>
              setMultifamilyExplorer((prev) => ({
                ...prev,
                search: event.target.value,
              }))
            }
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs min-w-[180px]"
            placeholder={`Search ${multifamilyExplorer.entityType}s`}
          />
          <button
            onClick={refreshMultifamilyEntities}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 hover:bg-gray-50"
          >
            Search
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-brand-gray">
            {selectedMultifamilyObject
              ? `Selected object: ${selectedMultifamilyObject.name} (${selectedMultifamilyObject.objectType})`
              : 'Select a multifamily object to start bulk tagging.'}
          </p>
          <button
            onClick={handleBulkAssociateExplorerEntities}
            disabled={
              !multifamilyExplorer.objectId ||
              selectedMultifamilyEntityKeys.length === 0 ||
              busyKey === `multifamily-bulk-${multifamilyExplorer.entityType}`
            }
            className="text-xs border border-indigo-200 text-indigo-700 rounded px-2 py-1 hover:bg-indigo-50 disabled:opacity-60"
          >
            {busyKey === `multifamily-bulk-${multifamilyExplorer.entityType}`
              ? 'Tagging...'
              : `Tag Selected (${selectedMultifamilyEntityKeys.length})`}
          </button>
        </div>

        {loadingMultifamilyEntities ? (
          <p className="text-xs text-brand-gray">Loading explorer entities...</p>
        ) : multifamilyEntities.length === 0 ? (
          <p className="text-xs text-brand-gray">No entities found for this search.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-left text-brand-gray">
                  <th className="py-2 pr-2">Select</th>
                  <th className="py-2 pr-2">Name</th>
                  <th className="py-2 pr-2">Context</th>
                  <th className="py-2 pr-2">Current Associations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {multifamilyEntities.slice(0, 40).map((entity) => {
                  const entityKey = multifamilyExplorer.entityType === 'company' ? entity.companyName || entity.id : entity.id
                  return (
                    <tr key={entityKey}>
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={Boolean(multifamilyEntitySelection[entityKey])}
                          onChange={(event) => handleToggleMultifamilyEntitySelection(entityKey, event.target.checked)}
                        />
                      </td>
                      <td className="py-2 pr-2 font-semibold text-navy">
                        {multifamilyExplorer.entityType === 'deal' ? entity.name : entity.name || entity.companyName}
                      </td>
                      <td className="py-2 pr-2 text-brand-gray">
                        {multifamilyExplorer.entityType === 'contact' &&
                          `${entity.email || 'No email'} • ${entity.company || 'No company'}`}
                        {multifamilyExplorer.entityType === 'deal' &&
                          `${entity.stage || 'unknown stage'} • ${entity.company || entity.contactName || 'No linked contact'}`}
                        {multifamilyExplorer.entityType === 'company' &&
                          `Contacts ${toInt(entity.contactCount)} • Leads ${toInt(entity.leadCount)}`}
                      </td>
                      <td className="py-2 pr-2 text-brand-gray">{toInt(entity.associationCount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-navy mb-2">
            Existing {multifamilyExplorer.entityType} associations for selected object
          </p>
          {objectAssociationsQuery.isLoading ? (
            <p className="text-xs text-brand-gray">Loading object associations...</p>
          ) : selectedObjectAssociations.length === 0 ? (
            <p className="text-xs text-brand-gray">No associations yet for this object/entity type.</p>
          ) : (
            <div className="space-y-1">
              {selectedObjectAssociations.slice(0, 15).map((association) => (
                <p key={association.id} className="text-xs text-brand-gray">
                  <span className="font-semibold text-navy">{association.target?.name || association.companyName || 'Unknown'}</span>
                  {association.target?.company ? ` • ${association.target.company}` : ''}
                  {association.target?.email ? ` • ${association.target.email}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
