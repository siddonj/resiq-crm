/**
 * Middleware factory that restricts a route to users with one of the given roles.
 * Must be used after the `auth` middleware (which sets req.user).
 *
 * Usage:
 *   router.delete('/:id', auth, requireRole('admin'), handler)
 *   router.get('/', auth, requireRole('admin', 'manager'), handler)
 */
module.exports = (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
