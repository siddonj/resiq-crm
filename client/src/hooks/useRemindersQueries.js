import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { remindersApi } from '../api/remindersApi'

const QK = {
  reminders: (filters) => ['reminders', filters],
}

/**
 * Fetch reminders with optional completion filter.
 * @param {string} token
 * @param {{ completed?: boolean }} [filters]
 */
export function useReminders(token, filters = {}) {
  return useQuery({
    queryKey: QK.reminders(filters),
    queryFn: () => remindersApi.getAll(token, filters).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Create a new reminder.
 */
export function useCreateReminder(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) =>
      remindersApi.create(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] })
    },
  })
}

/**
 * Toggle reminder completion.
 */
export function useCompleteReminder(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, completed }) =>
      remindersApi.complete(token, id, completed).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] })
    },
  })
}

/**
 * Delete a reminder.
 */
export function useDeleteReminder(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => remindersApi.delete(token, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] })
    },
  })
}
