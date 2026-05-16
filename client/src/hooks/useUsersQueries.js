import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '../api/usersApi'

const QK = {
  users: ['users'],
  clients: ['users', 'clients'],
  me: ['users', 'me'],
}

/**
 * Fetch all users.
 * @param {string} token
 */
export function useUsers(token) {
  return useQuery({
    queryKey: QK.users,
    queryFn: () => usersApi.getAll(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Get the current user.
 * @param {string} token
 */
export function useMe(token) {
  return useQuery({
    queryKey: QK.me,
    queryFn: () => usersApi.getMe(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Fetch client users.
 * @param {string} token
 */
export function useClients(token) {
  return useQuery({
    queryKey: QK.clients,
    queryFn: () => usersApi.getClients(token).then((r) => r.data),
    enabled: !!token,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Update current user's profile.
 */
export function useUpdateProfile(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) =>
      usersApi.updateMe(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', 'me'] })
    },
  })
}

/**
 * Update current user's password.
 */
export function useUpdatePassword(token) {
  return useMutation({
    mutationFn: (payload) =>
      usersApi.updatePassword(token, payload).then((r) => r.data),
  })
}

/**
 * Update a user's role.
 */
export function useUpdateUserRole(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }) =>
      usersApi.updateRole(token, userId, role).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

/**
 * Deactivate a user.
 */
export function useDeactivateUser(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId) =>
      usersApi.deactivate(token, userId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

/**
 * Activate a user.
 */
export function useActivateUser(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId) =>
      usersApi.activate(token, userId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

/**
 * Invite a new user.
 */
export function useInviteUser(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) =>
      usersApi.invite(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

/**
 * Invite a client/guest user.
 */
export function useInviteClient(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) =>
      usersApi.inviteClient(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', 'clients'] })
    },
  })
}
