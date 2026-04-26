/**
 * All valid user roles in the system.
 */
export const ALL_ROLES = ['admin', 'manager', 'rep', 'user', 'viewer']

/**
 * Human-readable labels for each role.
 * Both 'user' (legacy) and 'rep' map to "Rep" for display purposes.
 */
export const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager',
  rep: 'Rep',
  user: 'Rep',
  viewer: 'Viewer',
}
