import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { teamsApi } from '../api/teamsApi'

const QK = {
  teams: ['teams'],
  team: (id) => ['teams', id],
}

/**
 * Fetch all teams.
 * @param {string} token
 */
export function useTeams(token) {
  return useQuery({
    queryKey: QK.teams,
    queryFn: () => teamsApi.getAll(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Fetch a single team by ID (includes members).
 * @param {string} token
 * @param {string|number} id
 */
export function useTeam(token, id) {
  return useQuery({
    queryKey: QK.team(id),
    queryFn: () => teamsApi.getById(token, id).then((r) => r.data),
    enabled: !!token && !!id,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Create or update a team.
 */
export function useSaveTeam(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }) =>
      id
        ? teamsApi.update(token, id, payload).then((r) => r.data)
        : teamsApi.create(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

/**
 * Delete a team.
 */
export function useDeleteTeam(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => teamsApi.delete(token, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

/**
 * Add a member to a team.
 */
export function useAddTeamMember(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ teamId, member }) =>
      teamsApi.addMember(token, teamId, member).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

/**
 * Remove a member from a team.
 */
export function useRemoveTeamMember(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ teamId, userId }) =>
      teamsApi.removeMember(token, teamId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

/**
 * Update a member's role within a team.
 */
export function useUpdateTeamMemberRole(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ teamId, userId, role }) =>
      teamsApi.updateMemberRole(token, teamId, userId, role).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}
