require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const jwt = require('jsonwebtoken');
const { logger, createRequestLogger } = require('./utils/logger');

// Sentry error tracking (optional — init only if SENTRY_DSN is set)
let Sentry;
if (process.env.SENTRY_DSN) {
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  });
  logger.info('Sentry initialized');
}

const authRoutes = require('./routes/auth');
const clientAuthRoutes = require('./routes/clientAuth');
const clientPortalRoutes = require('./routes/clientPortal');
const clientsRoutes = require('./routes/clients');
const stripeRoutes = require('./routes/stripe');
const contactsRoutes = require('./routes/contacts');
const dealsRoutes = require('./routes/deals');
const workflowsRoutes = require('./routes/workflows');
const sequencesRoutes = require('./routes/sequences');
const integrationsRoutes = require('./routes/integrations');
const projectsRoutes = require('./routes/projects');
const analyticsRoutes = require('./routes/analytics');
const usersRoutes = require('./routes/users');
const teamsRoutes = require('./routes/teams');
const auditLogsRoutes = require('./routes/auditLogs');
const sharingRoutes = require('./routes/sharing');
const remindersRoutes = require('./routes/reminders');
const activitiesRoutes = require('./routes/activities');
const proposalsRoutes = require('./routes/proposals');
const invoicesRoutes = require('./routes/invoices');
const timeEntriesRoutes = require('./routes/timeEntries');
const calendarRoutes = require('./routes/calendar');
const smsRoutes = require('./routes/sms');
const webhookRoutes = require('./routes/webhooks');
const agentsRoutes = require('./routes/agents');
const formsRoutes = require('./routes/forms');
const leadsRoutes = require('./routes/leads');
const engagementRoutes = require('./routes/engagement');
const ticketsRoutes = require('./routes/tickets');
const redditLeadsRoutes = require('./routes/redditLeads');
const multiSourceLeadsRoutes = require('./routes/multiSourceLeads');
const outboundAutomationRoutes = require('./routes/outboundAutomation');
const appSettingsRoutes = require('./routes/appSettings');
const complianceRoutes = require('./routes/compliance');
const unsubscribeRoutes = require('./routes/unsubscribe');
const deliverabilityRoutes = require('./routes/deliverability');
const automationRoutes = require('./routes/automation');
const { startDealStageSequenceWorker } = require('./workers/dealStageSequenceWorker');
const { initEmailSyncWorker } = require('./workers/emailSyncWorker');
const { workflowQueue, initWorkflowQueueWorker } = require('./workers/workflowQueueWorker');
const { agentQueue, initAgentWorker } = require('./workers/agentWorker');
const { initSequenceWorker } = require('./workers/sequenceWorker');
const { MessageQueueService } = require('./services/messageQueue');
const WorkflowEngine = require('./services/workflowEngine');
const trackRoutes = require('./routes/track');
const portfoliosRoutes = require('./routes/portfolios');
const TicketWebSocketServer = require('./services/ticketWebSocket');
const orgsRoutes = require('./routes/orgs');
const membersRoutes = require('./routes/members');
const { requireOrg } = require('./middleware/requireOrg');
// authMiddleware = server/src/middleware/auth.js (JWT check) — runs before requireOrg on orgRouter
const authMiddleware = require('./middleware/auth');
const { resolveOrg } = require('./middleware/resolveOrg');

const app = express();

// CORS: restrict to an explicit allowlist (CORS_ORIGIN, comma-separated).
// No Origin header (same-origin / server-to-server) is always allowed.
// With no allowlist set, cross-origin is permitted only outside production.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) {
        return callback(null, process.env.NODE_ENV !== 'production');
      }
      return callback(null, allowedOrigins.includes(origin));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

const outboundLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Outbound rate limit exceeded.' },
});

app.use(generalLimiter);

// Standardized response envelopes
const responseHelpers = require('./middleware/responseHelpers');
app.use(responseHelpers);

// Request logging middleware (attach req.log to all requests)
app.use((req, res, next) => {
  req.log = createRequestLogger(req);
  req.log.debug({ query: req.query }, 'incoming request');
  next();
});

// Create HTTP server to support WebSocket upgrade
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ noServer: true });
const ticketWS = new TicketWebSocketServer();

// Add error handler to wss
wss.on('error', (error) => {
  logger.error({ err: error }, 'WebSocket server error');
});

// Handle WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  try {
    if (req.url.startsWith('/ws/tickets')) {
      const { verifyWebSocketToken } = require('./middleware/wsAuth');
      
      // Extract token from query parameter
      const urlParams = new URL(`http://localhost${req.url}`);
      const token = urlParams.searchParams.get('token');
      
      if (!token) {
        console.log('[WebSocket] Upgrade rejected: no token in query parameter');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const decoded = verifyWebSocketToken(token);
      if (!decoded) {
        console.log('[WebSocket] Upgrade rejected: invalid token');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      console.log(`[WebSocket] Token verified for user ${decoded.id}, calling wss.handleUpgrade`);
      try {
        wss.handleUpgrade(req, socket, head, (ws) => {
          console.log('[WebSocket] wss.handleUpgrade callback triggered, calling ticketWS.handleUpgrade');
          ticketWS.handleUpgrade(ws, req, decoded.id);
        });
      } catch (upgradeErr) {
        console.error('[WebSocket] wss.handleUpgrade failed:', upgradeErr);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    }
  } catch (err) {
    console.error('[WebSocket] Upgrade error:', err);
    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    socket.destroy();
  }
});

// Make ticketWS available to routes
app.locals.ticketWS = ticketWS;

// Initialize workflow engine with queue
const workflowEngine = new WorkflowEngine(workflowQueue);

// Inject workflow engine into routes that dispatch triggers
dealsRoutes.setWorkflowEngine(workflowEngine);
contactsRoutes.setWorkflowEngine(workflowEngine);

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/auth', authLimiter, clientAuthRoutes);
app.use('/api/client', clientPortalRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/stripe', stripeRoutes);

// Global org management (not under :orgSlug)
app.use('/api/orgs', authMiddleware, orgsRoutes);

// Public unsubscribe link — no auth required
app.use('/api/unsubscribe', unsubscribeRoutes);

// ── Org-scoped routes (legacy flat paths — kept for backward compat) ──────────
// authMiddleware + resolveOrg derive req.orgId from the caller's organization_members
// row (see server/src/middleware/resolveOrg.js). Excluded per docs/superpowers/plans/org-inventory.md:
// /api/auth, /api/client, /api/clients, /api/stripe, /api/orgs, /api/unsubscribe, /api/webhooks.
app.use('/api/contacts', authMiddleware, resolveOrg, contactsRoutes);
app.use('/api/deals', authMiddleware, resolveOrg, dealsRoutes);
app.use('/api/workflows', authMiddleware, resolveOrg, workflowsRoutes);
app.use('/api/sequences', authMiddleware, resolveOrg, sequencesRoutes);
// integrations.js has public OAuth callback routes (/gmail/callback, /gcal/callback) and
// does not read req.orgId in any handler — mount-level auth/resolveOrg would break the
// callback flow, so it is intentionally left unwired (per-route `auth` still applies).
app.use('/api/integrations', integrationsRoutes);
app.use('/api/projects', authMiddleware, resolveOrg, projectsRoutes);
app.use('/api/analytics', authMiddleware, resolveOrg, analyticsRoutes);
// users.js does not read req.orgId (users table is org-infra, not tenant data), and
// /api/users/me is called on every app load to hydrate the session before any org exists
// (client/src/context/AuthContext.jsx logs the user out on 4xx) — resolveOrg would force-
// logout every user without a membership, so this mount is intentionally left unwired.
// (users.js already applies `auth` per-route internally.)
app.use('/api/users', usersRoutes);
app.use('/api/teams', authMiddleware, resolveOrg, teamsRoutes);
app.use('/api/audit-logs', authMiddleware, resolveOrg, auditLogsRoutes);
app.use('/api/sharing', authMiddleware, resolveOrg, sharingRoutes);
app.use('/api/reminders', authMiddleware, resolveOrg, remindersRoutes);
app.use('/api/activities', authMiddleware, resolveOrg, activitiesRoutes);
app.use('/api/proposals', authMiddleware, resolveOrg, proposalsRoutes);
app.use('/api/invoices', authMiddleware, resolveOrg, invoicesRoutes);
app.use('/api/time-entries', authMiddleware, resolveOrg, timeEntriesRoutes);
// calendar.js has public booking routes (/book/:slug) alongside authed routes that DO read
// req.orgId — mount-level auth/resolveOrg would break public booking. See report: this is a
// flagged gap (authed sub-routes need per-route resolveOrg, out of scope for mount wiring).
app.use('/api/calendar', calendarRoutes);
app.use('/api/sms', authMiddleware, resolveOrg, smsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/agents', authMiddleware, resolveOrg, agentsRoutes);
app.use('/api/forms', authMiddleware, resolveOrg, formsRoutes);
// leads.js is a public form-submission endpoint (no auth) that resolves org via the
// formId, not req.orgId — mount-level auth/resolveOrg would break external form submits.
app.use('/api/leads', leadsRoutes);
app.use('/api/multi-source-leads', authMiddleware, resolveOrg, multiSourceLeadsRoutes);
app.use('/api/outbound', outboundLimiter, authMiddleware, resolveOrg, outboundAutomationRoutes);
app.use('/api/app-settings', authMiddleware, resolveOrg, appSettingsRoutes);
app.use('/api/compliance', authMiddleware, resolveOrg, complianceRoutes);
app.use('/api/deliverability', authMiddleware, resolveOrg, deliverabilityRoutes);
app.use('/api/engagement', authMiddleware, resolveOrg, engagementRoutes);
app.use('/api/tickets', authMiddleware, resolveOrg, ticketsRoutes);
app.use('/api/reddit-leads', authMiddleware, resolveOrg, redditLeadsRoutes);
// track.js has public tracking-pixel/link routes alongside authed routes (/create,
// /contact/:contactId, /asset/...) that DO read req.orgId — same flagged gap as calendar.js
// (mount-level auth/resolveOrg would break public pixel tracking used in sent emails).
app.use('/api/track', trackRoutes);
app.use('/api/portfolios', authMiddleware, resolveOrg, portfoliosRoutes);
app.use('/api/automation', authMiddleware, resolveOrg, automationRoutes);

// ── Org-scoped routes under /api/org/:orgSlug ────────────────────────────────
const orgRouter = express.Router({ mergeParams: true });
orgRouter.use(authMiddleware);  // server/src/middleware/auth.js — sets req.user
orgRouter.use(requireOrg);      // sets req.orgId, req.org, req.orgRole

orgRouter.use('/contacts',           contactsRoutes);
orgRouter.use('/deals',              dealsRoutes);
orgRouter.use('/workflows',          workflowsRoutes);
orgRouter.use('/sequences',          sequencesRoutes);
orgRouter.use('/integrations',       integrationsRoutes);
orgRouter.use('/projects',           projectsRoutes);
orgRouter.use('/analytics',          analyticsRoutes);
orgRouter.use('/users',              usersRoutes);
orgRouter.use('/teams',              teamsRoutes);
orgRouter.use('/audit-logs',         auditLogsRoutes);
orgRouter.use('/sharing',            sharingRoutes);
orgRouter.use('/reminders',          remindersRoutes);
orgRouter.use('/activities',         activitiesRoutes);
orgRouter.use('/proposals',          proposalsRoutes);
orgRouter.use('/invoices',           invoicesRoutes);
orgRouter.use('/time-entries',       timeEntriesRoutes);
orgRouter.use('/calendar',           calendarRoutes);
orgRouter.use('/sms',                smsRoutes);
orgRouter.use('/webhooks',           webhookRoutes);
orgRouter.use('/agents',             agentsRoutes);
orgRouter.use('/forms',              formsRoutes);
orgRouter.use('/leads',              leadsRoutes);
orgRouter.use('/multi-source-leads', multiSourceLeadsRoutes);
orgRouter.use('/outbound',           outboundLimiter, outboundAutomationRoutes);
orgRouter.use('/app-settings',       appSettingsRoutes);
orgRouter.use('/compliance',         complianceRoutes);
orgRouter.use('/deliverability',     deliverabilityRoutes);
orgRouter.use('/engagement',         engagementRoutes);
orgRouter.use('/tickets',            ticketsRoutes);
orgRouter.use('/reddit-leads',       redditLeadsRoutes);
orgRouter.use('/track',              trackRoutes);
orgRouter.use('/portfolios',         portfoliosRoutes);
orgRouter.use('/automation',         automationRoutes);
orgRouter.use('/members',            membersRoutes);

app.use('/api/org/:orgSlug', orgRouter);

app.get('/api/health', async (req, res) => {
  const checks = {};
  let overall = 'ok';

  // Check PostgreSQL
  try {
    const pool = require('./models/db');
    await pool.query('SELECT 1');
    checks.database = 'ok';
  } catch (err) {
    checks.database = 'error';
    overall = 'error';
  }

  // Check Redis (if configured)
  try {
    const Redis = require('ioredis');
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
    await redis.ping();
    await redis.quit();
    checks.redis = 'ok';
  } catch (err) {
    checks.redis = 'error';
    overall = 'error';
  }

  const statusCode = overall === 'ok' ? 200 : 503;
  if (overall === 'ok') {
    return res.sendSuccess({ status: overall, checks });
  }
  return res.sendError('Service unhealthy', 'HEALTH_CHECK_FAILED', statusCode);
});

async function initDatabase() {
  const pool = require('./models/db');
  const fs = require('fs');

  // Acquire advisory lock — prevents two concurrent boots from racing
  try {
    await pool.query("SELECT pg_advisory_xact_lock(847261004)");
  } catch (_) {
    // Lock not available, proceed anyway (single-instance deployments)
  }

  // Ensure _schema_version tracking table exists
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _schema_version (
        version     TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum    TEXT
      )
    `);
    logger.info('Schema version tracking table ready');
  } catch (err) {
    // Table may already exist from migration runner
  }

  // Apply base schema
  const schemaPath = path.join(__dirname, '../../database/schema.sql');
  if (fs.existsSync(schemaPath)) {
    try {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(sql);
      logger.info('Database schema applied successfully');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        logger.error({ err }, 'Schema init error');
      }
    }
  }

  // Apply OAuth columns migration (idempotent)
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_access_token TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_expires_at TIMESTAMPTZ;
    `);
    logger.info('OAuth columns migration applied');
  } catch (err) {
    logger.error({ err }, 'OAuth columns migration error');
  }

  // Run any tracked migrations that haven't been applied yet
  try {
    const migrationsDir = path.join(__dirname, '../../database/migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        // Check if already applied
        const { rows } = await pool.query(
          'SELECT 1 FROM _schema_version WHERE version = $1',
          [file.replace(/\.sql$/, '')]
        );
        if (rows.length > 0) continue;

        const filePath = path.join(migrationsDir, file);
        const migrationSql = fs.readFileSync(filePath, 'utf8');

        await pool.query(migrationSql);

        // Record as applied
        await pool.query(
          'INSERT INTO _schema_version (version, description) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [file.replace(/\.sql$/, ''), file]
        );

        logger.info({ migration: file }, 'Migration applied on boot');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Auto-migration check failed (non-fatal on boot)');
  }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  logger.info({ port: PORT }, 'ResiQ CRM server started');
  await initDatabase();

  // Initialize message queue (for SMS)
  try {
    MessageQueueService.initialize();
    logger.info('Message queue initialized');
  } catch (err) {
    logger.warn({ err }, 'Message queue init failed (Redis may not be running)');
  }

  // Initialize workflow queue worker (requires Redis)
  try {
    await initWorkflowQueueWorker();
    logger.info('Workflow queue worker initialized');
  } catch (err) {
    logger.warn({ err }, 'Workflow queue worker init failed (Redis may not be running)');
  }

  // Initialize email sync worker (requires Redis)
  try {
    await initEmailSyncWorker();
    logger.info('Email sync worker initialized');
  } catch (err) {
    logger.warn({ err }, 'Email sync worker init failed');
  }

  // Initialize agent queue worker (requires Redis)
  try {
    initAgentWorker();
    logger.info('Agent worker initialized');
  } catch (err) {
    logger.warn({ err }, 'Agent worker init failed');
  }

  // Initialize sequence worker
  try {
    initSequenceWorker();
    logger.info('Sequence worker initialized');
  } catch (err) {
    logger.warn({ err }, 'Sequence worker init failed');
  }

  // Initialize enrichment worker (requires Redis)
  try {
    require('./workers/enrichmentWorker');
    logger.info('Enrichment worker initialized');
  } catch (err) {
    logger.warn({ err }, 'Enrichment worker init failed');
  }

  // Initialize deal stage sequence worker
  try {
    startDealStageSequenceWorker();
    logger.info('Deal stage sequence worker initialized');
  } catch (err) {
    logger.warn({ err }, 'Deal stage sequence worker init failed');
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Sentry error handler (must be after all routes but before express error handlers)
if (Sentry) {
  app.use(Sentry.Handlers.errorHandler());
}

// Serve React client in production
if (process.env.NODE_ENV === 'production') {
  // Return JSON 404 for unknown API routes instead of serving index.html.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}


