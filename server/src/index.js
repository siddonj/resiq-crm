require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const jwt = require('jsonwebtoken');
const { logger, createRequestLogger } = require('./utils/logger');

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
const { initEmailSyncWorker } = require('./workers/emailSyncWorker');
const { workflowQueue, initWorkflowQueueWorker } = require('./workers/workflowQueueWorker');
const { agentQueue, initAgentWorker } = require('./workers/agentWorker');
const { initSequenceWorker } = require('./workers/sequenceWorker');
const { MessageQueueService } = require('./services/messageQueue');
const WorkflowEngine = require('./services/workflowEngine');
const trackRoutes = require('./routes/track');
const portfoliosRoutes = require('./routes/portfolios');
const TicketWebSocketServer = require('./services/ticketWebSocket');

const app = express();
app.use(cors());
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
app.use('/api/contacts', contactsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/sequences', sequencesRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/audit-logs', auditLogsRoutes);
app.use('/api/sharing', sharingRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/proposals', proposalsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/time-entries', timeEntriesRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/multi-source-leads', multiSourceLeadsRoutes);
app.use('/api/outbound', outboundLimiter, outboundAutomationRoutes);
app.use('/api/app-settings', appSettingsRoutes);
app.use('/api/engagement', engagementRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/reddit-leads', redditLeadsRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/portfolios', portfoliosRoutes);

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

  // Migrations are NO LONGER auto-run on boot.
  // Use: npm run migrate
  logger.info('Skipping auto-migrations. Run `npm run migrate` to apply pending migrations.');
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
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

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

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
