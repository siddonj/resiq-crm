import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dealsApi } from '../api/dealsApi'

const QK = {
  deals: (filters) => ['deals', filters],
  deal: (id) => ['deals', id],
}

/**
 * Fetch deals with optional filters.
 * @param {string} token
 * @param {{ search?: string, stage?: string, service_line?: string }} [filters]
 */
export function useDeals(token, filters = {}) {
  return useQuery({
    queryKey: QK.deals(filters),
    queryFn: () => dealsApi.getAll(token, filters).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Fetch a single deal by ID.
 * @param {string} token
 * @param {string|number} id
 */
export function useDeal(token, id) {
  return useQuery({
    queryKey: QK.deal(id),
    queryFn: () => dealsApi.getById(token, id).then((r) => r.data),
    enabled: !!token && !!id,
  })
}

/**
 * Create or update a deal.
 */
export function useSaveDeal(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }) =>
      id
        ? dealsApi.update(token, id, payload).then((r) => r.data)
        : dealsApi.create(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] })
    },
  })
}

/**
 * Delete a deal.
 */
export function useDeleteDeal(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => dealsApi.delete(token, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] })
    },
  })
}

/**
 * Update the stage of a deal (drag & drop).
 */
export function useUpdateDealStage(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ dealId, stage }) =>
      dealsApi.updateStage(token, dealId, stage).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] })
    },
  })
}

/**
 * Export deals as CSV blob.
 */
export function useExportDeals(token) {
  return useMutation({
    mutationFn: (filters) =>
      dealsApi.export(token, filters).then((r) => r.data),
  })
}
