import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { contactsApi } from '../api/contactsApi'

const QK = {
  contacts: (filters) => ['contacts', filters],
  contact: (id) => ['contacts', id],
}

/**
 * Fetch contacts with optional filters.
 * @param {string} token
 * @param {{ search?: string, type?: string, service_line?: string }} [filters]
 */
export function useContacts(token, filters = {}) {
  return useQuery({
    queryKey: QK.contacts(filters),
    queryFn: () => contactsApi.getAll(token, filters).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Fetch a single contact by ID.
 * @param {string} token
 * @param {string|number} id
 */
export function useContact(token, id) {
  return useQuery({
    queryKey: QK.contact(id),
    queryFn: () => contactsApi.getById(token, id).then((r) => r.data),
    enabled: !!token && !!id,
  })
}

/**
 * Create or update a contact.
 * Returns the saved contact record.
 */
export function useSaveContact(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }) =>
      id
        ? contactsApi.update(token, id, payload).then((r) => r.data)
        : contactsApi.create(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

/**
 * Delete a contact.
 */
export function useDeleteContact(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => contactsApi.delete(token, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

/**
 * Export contacts as CSV blob.
 */
export function useExportContacts(token) {
  return useMutation({
    mutationFn: (filters) =>
      contactsApi.export(token, filters).then((r) => r.data),
  })
}

/**
 * Import contacts from CSV.
 */
export function useImportContacts(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, enrich }) =>
      contactsApi.import(token, file, enrich).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

/**
 * Enrich a single contact (AI).
 */
export function useEnrichContact(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => contactsApi.enrich(token, id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

/**
 * Bulk enrich contacts.
 */
export function useBulkEnrichContacts(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids) => contactsApi.bulkEnrich(token, ids).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}
