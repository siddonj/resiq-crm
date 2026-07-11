const { db } = require('../db');

// Derives req.orgId from the caller's server-side membership when the route
// has no :orgSlug param. Org identity never comes from the URL or token here.
// Fails closed on every ambiguous or missing case.
async function resolveOrg(req, res, next) {
  if (!req.user) {
    return res.sendError('Unauthorized', 'UNAUTHENTICATED', 401);
  }

  // Slug-based routes are handled by requireOrg, not here.
  if (req.params && req.params.orgSlug) return next();

  try {
    const memberships = await db
      .selectFrom('organization_members as om')
      .innerJoin('organizations as o', 'o.id', 'om.organization_id')
      .where('om.user_id', '=', req.user.id)
      .select(['om.organization_id as organization_id', 'om.role as role', 'o.slug as slug', 'o.name as name'])
      .execute();

    if (!memberships.length) {
      return res.sendError('Organization membership required', 'ORG_REQUIRED', 403);
    }
    if (memberships.length > 1 && !req.user.is_super_admin) {
      return res.sendError('Organization is ambiguous; use an org-scoped route', 'ORG_AMBIGUOUS', 403);
    }

    const m = memberships[0];
    req.orgId = m.organization_id;
    req.orgRole = m.role;
    req.org = { id: m.organization_id, slug: m.slug, name: m.name };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { resolveOrg };
