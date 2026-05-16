import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '../api/projectsApi'

const QK = {
  projects: ['projects'],
  project: (id) => ['projects', id],
  templates: ['projects', 'templates'],
  members: (projectId) => ['projects', projectId, 'members'],
  baselines: (projectId) => ['projects', projectId, 'baselines'],
}

/**
 * Fetch all projects.
 * @param {string} token
 */
export function useProjects(token) {
  return useQuery({
    queryKey: QK.projects,
    queryFn: () => projectsApi.getAll(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Fetch a single project by ID.
 * @param {string} token
 * @param {string|number} id
 */
export function useProject(token, id) {
  return useQuery({
    queryKey: QK.project(id),
    queryFn: () => projectsApi.getById(token, id).then((r) => r.data),
    enabled: !!token && !!id,
  })
}

/**
 * Fetch project templates.
 * @param {string} token
 */
export function useProjectTemplates(token) {
  return useQuery({
    queryKey: QK.templates,
    queryFn: () => projectsApi.getTemplates(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Fetch project members.
 * @param {string} token
 * @param {string|number} projectId
 */
export function useProjectMembers(token, projectId) {
  return useQuery({
    queryKey: QK.members(projectId),
    queryFn: () => projectsApi.getMembers(token, projectId).then((r) => r.data),
    enabled: !!token && !!projectId,
  })
}

/**
 * Fetch project baselines.
 * @param {string} token
 * @param {string|number} projectId
 */
export function useProjectBaselines(token, projectId) {
  return useQuery({
    queryKey: QK.baselines(projectId),
    queryFn: () => projectsApi.getBaselines(token, projectId).then((r) => r.data),
    enabled: !!token && !!projectId,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Create a new project.
 */
export function useCreateProject(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) =>
      projectsApi.create(token, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

/**
 * Update a project.
 */
export function useUpdateProject(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }) =>
      projectsApi.update(token, id, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

/**
 * Save a project as a template.
 */
export function useSaveProjectAsTemplate(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId) =>
      projectsApi.saveAsTemplate(token, projectId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', 'templates'] })
    },
  })
}

/**
 * Create a baseline snapshot for a project.
 */
export function useCreateProjectBaseline(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, name }) =>
      projectsApi.createBaseline(token, projectId, name).then((r) => r.data),
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ['projects', variables.projectId, 'baselines'] })
    },
  })
}
