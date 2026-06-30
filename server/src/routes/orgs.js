// server/src/routes/orgs.js
const express = require('express');
const { db } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function requireSuperAdmin(req, res, next) {
  if (!req.user?.is_super_admin) {
    return res.sendError('Super-admin access required', 'FORBIDDEN', 403);
  }
  next();
}

// GET /api/orgs — super-admin: list all orgs with member counts
router.get('/', auth, requireSuperAdmin, async (req, res) => {
  try {
    const orgs = await db.selectFrom('organizations as o')
      .leftJoin('organization_members as om', 'om.organization_id', 'o.id')
      .select([
        'o.id',
        'o.name',
        'o.slug',
        'o.created_at',
        db.fn.count('om.id').castTo('integer').as('member_count'),
      ])
      .groupBy(['o.id', 'o.name', 'o.slug', 'o.created_at'])
      .orderBy('o.created_at', 'asc')
      .execute();
    res.sendSuccess(orgs);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// GET /api/orgs/mine — current user's orgs
router.get('/mine', auth, async (req, res) => {
  try {
    let orgs;
    if (req.user.is_super_admin) {
      orgs = await db.selectFrom('organizations')
        .selectAll()
        .orderBy('created_at', 'asc')
        .execute();
    } else {
      orgs = await db.selectFrom('organizations as o')
        .innerJoin('organization_members as om', 'om.organization_id', 'o.id')
        .where('om.user_id', '=', req.user.id)
        .select(['o.id', 'o.name', 'o.slug', 'o.created_at', 'om.role'])
        .orderBy('o.created_at', 'asc')
        .execute();
    }
    res.sendSuccess(orgs);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// GET /api/orgs/:slug — resolve org by slug (used by OrgShell)
router.get('/:slug', auth, async (req, res) => {
  try {
    const org = await db.selectFrom('organizations')
      .where('slug', '=', req.params.slug)
      .select(['id', 'name', 'slug', 'created_at'])
      .executeTakeFirst();

    if (!org) return res.sendError('Organization not found', 'ORG_NOT_FOUND', 404);

    // Non-super-admins must be members
    if (!req.user.is_super_admin) {
      const membership = await db.selectFrom('organization_members')
        .where('organization_id', '=', org.id)
        .where('user_id', '=', req.user.id)
        .select('role')
        .executeTakeFirst();
      if (!membership) return res.sendError('Access denied', 'ORG_FORBIDDEN', 403);
    }

    res.sendSuccess(org);
  } catch (err) {
    res.sendError(err.message, 'SERVER_ERROR', 500);
  }
});

// POST /api/orgs — super-admin: create org
router.post('/', auth, requireSuperAdmin, async (req, res) => {
  const { name, slug: rawSlug } = req.body;
  if (!name) return res.sendError('name is required', 'VALIDATION_ERROR', 400);

  const slug = rawSlug ? slugify(rawSlug) : slugify(name);

  try {
    const org = await db.transaction().execute(async (trx) => {
      const [created] = await trx.insertInto('organizations')
        .values({ name, slug })
        .returningAll()
        .execute();

      await trx.insertInto('organization_members')
        .values({ organization_id: created.id, user_id: req.user.id, role: 'owner' })
        .execute();

      return created;
    });

    res.sendSuccess(org);
  } catch (err) {
    if (err.code === '23505') {
      return res.sendError('Slug already taken', 'SLUG_CONFLICT', 409);
    }
    next(err);
  }
});

module.exports = router;
