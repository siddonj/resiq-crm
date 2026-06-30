// server/src/tests/helpers/orgTestHelpers.js
// Shared mock factories for org isolation tests.
// These helpers build mock req objects — they do NOT hit a real database.

function makeOrg(slug) {
  return { id: `org-${slug}-id`, name: slug, slug };
}

function makeUser(orgId, options = {}) {
  return {
    id: options.id || `user-${orgId}-${Math.random().toString(36).slice(2)}`,
    email: options.email || `user@${orgId}.com`,
    role: options.role || 'user',
    is_super_admin: options.is_super_admin || false,
  };
}

function makeSuperAdmin() {
  return {
    id: 'super-admin-id',
    email: 'admin@resiq.com',
    role: 'admin',
    is_super_admin: true,
  };
}

/**
 * Builds an Express app with the given route handler, wired with:
 * - A mock auth middleware that sets req.user via x-test-user header
 * - A mock requireOrg middleware that sets req.orgId based on URL slug
 *   and validates membership (rejects if user.orgId !== slug-based org)
 */
function buildIsolationApp(express, routerFactory, orgMap) {
  const app = express();
  app.use(express.json());

  // Wire res.sendSuccess / res.sendError
  app.use((req, res, next) => {
    res.sendSuccess = (data) => res.json({ success: true, data });
    res.sendError = (msg, code, status) => res.status(status).json({ error: msg, code });
    next();
  });

  // Mock auth — user is set by test via req header x-test-user (JSON)
  app.use((req, res, next) => {
    const userHeader = req.headers['x-test-user'];
    req.user = userHeader ? JSON.parse(userHeader) : makeSuperAdmin();
    next();
  });

  // Mock requireOrg — validates membership using orgMap
  app.use('/api/org/:orgSlug', (req, res, next) => {
    const { orgSlug } = req.params;
    const org = orgMap[orgSlug];
    if (!org) return res.sendError('Organization not found', 'ORG_NOT_FOUND', 404);

    if (!req.user.is_super_admin) {
      // user must belong to this org (we simulate by checking user.orgId)
      if (req.user.orgId !== org.id) {
        return res.sendError('Access denied', 'ORG_FORBIDDEN', 403);
      }
      req.orgRole = 'member';
    }
    req.orgId = org.id;
    req.org = org;
    next();
  });

  app.use('/api/org/:orgSlug', routerFactory());

  return app;
}

module.exports = { makeOrg, makeUser, makeSuperAdmin, buildIsolationApp };
