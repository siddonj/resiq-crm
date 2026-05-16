import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoicesApi } from '../api/invoicesApi'

const QK = {
  invoices: (filters) => ['invoices', filters],
  invoice: (id) => ['invoices', id],
  vendors: ['invoices', 'vendors'],
  categories: ['invoices', 'expense-categories'],
  products: ['invoices', 'products'],
  templates: ['invoices', 'templates'],
}

/**
 * Fetch invoices with optional status filter.
 * @param {string} token
 * @param {{ status?: string }} [filters]
 */
export function useInvoices(token, filters = {}) {
  return useQuery({
    queryKey: QK.invoices(filters),
    queryFn: () => invoicesApi.getAll(token, filters).then((r) => r.data),
    enabled: !!token,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Create or update an invoice.
 */
export function useSaveInvoice(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }) =>
      id
        ? invoicesApi.update(token, id, payload).then((r) => r.data)
        : invoicesApi.create(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

/**
 * Delete an invoice.
 */
export function useDeleteInvoice(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => invoicesApi.delete(token, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

/**
 * Update invoice status.
 */
export function useUpdateInvoiceStatus(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }) =>
      invoicesApi.updateStatus(token, id, status).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

/**
 * Set Stripe/online payment URL for an invoice.
 */
export function useCreateInvoicePaymentLink(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stripePaymentUrl }) =>
      invoicesApi.createPaymentLink(token, id, stripePaymentUrl).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

/**
 * Record a manual payment on an invoice.
 */
export function useRecordInvoicePayment(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payment }) =>
      invoicesApi.recordPayment(token, id, payment).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

// ── Sub-resource queries ──────────────────────────────────────────────────────

/** @param {string} token */
export function useInvoiceVendors(token) {
  return useQuery({
    queryKey: QK.vendors,
    queryFn: () => invoicesApi.getVendors(token).then((r) => r.data),
    enabled: !!token,
  })
}

/** @param {string} token */
export function useInvoiceExpenseCategories(token) {
  return useQuery({
    queryKey: QK.categories,
    queryFn: () => invoicesApi.getExpenseCategories(token).then((r) => r.data),
    enabled: !!token,
  })
}

/** @param {string} token */
export function useInvoiceProducts(token) {
  return useQuery({
    queryKey: QK.products,
    queryFn: () => invoicesApi.getProducts(token).then((r) => r.data),
    enabled: !!token,
  })
}

/** @param {string} token */
export function useInvoiceTemplates(token) {
  return useQuery({
    queryKey: QK.templates,
    queryFn: () => invoicesApi.getTemplates(token).then((r) => r.data),
    enabled: !!token,
  })
}
