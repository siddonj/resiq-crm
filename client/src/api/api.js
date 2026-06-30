import axios from 'axios'
import { getActiveOrgSlug } from '../context/OrgContext'

/**
 * Base Axios instance with default config and auth interceptor.
 *
 * Uses the Authorization token from the interceptor instead of passing
 * it to every call. For backward compatibility with existing patterns,
 * individual API modules also export getAuthHeaders() for manual use.
 */

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach auth token and prepend org slug for tenant-scoped requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('resiq_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  // Prepend /org/:slug for all tenant-scoped requests.
  // Skip public endpoints: /auth, /orgs, /book, /client, /track, /unsubscribe.
  const slug = getActiveOrgSlug()
  const isPublic = ['/auth', '/orgs', '/book', '/client', '/track', '/unsubscribe']
    .some((prefix) => config.url.startsWith(prefix))

  if (slug && !isPublic) {
    config.url = `/org/${slug}${config.url}`
  }

  return config
})

// Normalize errors so callers always get a consistent shape
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected error occurred'
    return Promise.reject(new Error(message))
  },
)

/**
 * Helper to build auth headers manually (used by individual API modules).
 * @param {string|null} token
 * @returns {{ headers: { Authorization: string } }}
 */
export function getAuthHeaders(token) {
  return {
    headers: { Authorization: `Bearer ${token}` },
  }
}

export default api
