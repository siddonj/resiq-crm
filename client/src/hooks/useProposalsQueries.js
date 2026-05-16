import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { proposalsApi } from '../api/proposalsApi'

const QK = {
  proposals: (filters) => ['proposals', filters],
  proposal: (id) => ['proposals', id],
}

/**
 * Fetch proposals with optional filters.
 * @param {string} token
 * @param {{ status?: string, deal_id?: string }} [filters]
 */
export function useProposals(token, filters = {}) {
  return useQuery({
    queryKey: QK.proposals(filters),
    queryFn: () => proposalsApi.getAll(token, filters).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Fetch a single proposal by ID.
 * @param {string} token
 * @param {string|number} id
 */
export function useProposal(token, id) {
  return useQuery({
    queryKey: QK.proposal(id),
    queryFn: () => proposalsApi.getById(token, id).then((r) => r.data),
    enabled: !!token && !!id,
  })
}

/**
 * Create or update a proposal.
 */
export function useSaveProposal(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }) =>
      id
        ? proposalsApi.update(token, id, payload).then((r) => r.data)
        : proposalsApi.create(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals'] })
    },
  })
}

/**
 * Delete a proposal.
 */
export function useDeleteProposal(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => proposalsApi.delete(token, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals'] })
    },
  })
}

/**
 * Update proposal status.
 */
export function useUpdateProposalStatus(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }) =>
      proposalsApi.updateStatus(token, id, status).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals'] })
    },
  })
}

/**
 * Sign a proposal electronically.
 */
export function useSignProposal(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }) =>
      proposalsApi.sign(token, id, name).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals'] })
    },
  })
}

/**
 * Parse a docx file to populate proposal sections.
 */
export function useParseProposalDoc(token) {
  return useMutation({
    mutationFn: (file) =>
      proposalsApi.parseDoc(token, file).then((r) => r.data),
  })
}
