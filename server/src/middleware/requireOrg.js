const { db } = require('../db');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const CACHE_TTL = 300;

async function requireOrg(req, res, next) {
  // Defense-in-depth: requireOrg must run after authMiddleware. If it is ever
  // wired onto a route where auth did not run, fail closed with a clean 401
  // instead of throwing a TypeError on req.user below.
  if (!req.user) {
    return res.sendError('Unauthorized', 'UNAUTHENTICATED', 401);
  }

  const { orgSlug } = req.params;
  const cacheKey = `org:slug:${orgSlug}`;

  try {
    let org = null;
    const cached = await redis.get(cacheKey);
    if (cached) {
      org = JSON.parse(cached);
    } else {
      org = await db.selectFrom('organizations')
        .where('slug', '=', orgSlug)
        .select(['id', 'name', 'slug'])
        .executeTakeFirst();

      if (!org) {
        return res.sendError('Organization not found', 'ORG_NOT_FOUND', 404);
      }
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(org));
    }

    if (!req.user.is_super_admin) {
      const membership = await db.selectFrom('organization_members')
        .where('organization_id', '=', org.id)
        .where('user_id', '=', req.user.id)
        .select(['role'])
        .executeTakeFirst();

      if (!membership) {
        return res.sendError('Access denied', 'ORG_FORBIDDEN', 403);
      }
      req.orgRole = membership.role;
    }

    req.orgId = org.id;
    req.org   = org;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireOrg };
