require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const jwt = require('jsonwebtoken');

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
const { initEmailSyncWorker } = require('./workers/emailSyncWorker');
const { workflowQueue, initWorkflowQueueWorker } = require('./workers/workflowQueueWorker');
const { agentQueue, initAgentWorker } = require('./workers/agentWorker');
const { initSequenceWorker } = require('./workers/sequenceWorker');
const { MessageQueueService } = require('./services/messageQueue');
const WorkflowEngine = require('./services/workflowEngine');
const trackRoutes = require('./routes/track');
const TicketWebSocketServer = require('./services/ticketWebSocket');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create HTTP server to support WebSocket upgrade
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ noServer: true });
const ticketWS = new TicketWebSocketServer();

// Handle WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/tickets') {
    const { getTokenFromRequest, verifyWebSocketToken } = require('./middleware/wsAuth');
    
    // Extract token from Sec-WebSocket-Protocol header
    const protocol = req.headers['sec-websocket-protocol'];
    const token = protocol ? protocol.split(' ').pop() : null;
    
    if (!token) {
      console.log('WebSocket upgrade rejected: no token');
      socket.destroy();
      return;
    }

    const decoded = verifyWebSocketToken(token);
    if (!decoded) {
      console.log('WebSocket upgrade rejected: invalid token');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ticketWS.handleUpgrade(ws, req, decoded.id);
    });
  }
});

// Make ticketWS available to routes
app.locals.ticketWS = ticketWS;

// Initialize workflow engine with queue
const workflowEngine = new WorkflowEngine(workflowQueue);

// Inject workflow engine into routes that dispatch triggers
dealsRoutes.setWorkflowEngine(workflowEngine);
contactsRoutes.setWorkflowEngine(workflowEngine);

app.use('/api/auth', authRoutes);
app.use('/api/auth', clientAuthRoutes);
app.use('/api/client', clientPortalRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/sequences', sequencesRoutes);
app.use('/api/integrations', integrationsRoutes);
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
app.use('/api/engagement', engagementRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/track', trackRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

async function initDatabase() {
  const pool = require('./models/db');
  const fs = require('fs');

  // Apply base schema
  const schemaPath = path.join(__dirname, '../../database/schema.sql');
  if (fs.existsSync(schemaPath)) {
    try {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(sql);
      console.log('Database schema applied successfully');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.error('Schema init error:', err.message);
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
  } catch (err) {
    console.error('OAuth columns migration error:', err.message);
  }

  // Apply all migration files in order
  const migrationsDir = path.join(__dirname, '../../database/migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      try {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await pool.query(sql);
        console.log(`Migration applied: ${file}`);
      } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
          console.error(`Migration error (${file}):`, err.message);
        }
      }
    }
  }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`ResiQ CRM server running on port ${PORT}`);
  console.log(`✓ WebSocket support enabled at ws://localhost:${PORT}/ws/tickets`);
  await initDatabase();

  // Initialize message queue (for SMS)
  try {
    MessageQueueService.initialize();
  } catch (err) {
    console.warn('Message queue init failed (Redis may not be running):', err.message);
    console.warn('SMS will not send until Redis is available');
  }

  // Initialize workflow queue worker (requires Redis)
  try {
    await initWorkflowQueueWorker();
  } catch (err) {
    console.warn('Workflow queue worker init failed (Redis may not be running):', err.message);
    console.warn('Workflows will not execute until Redis is available');
  }

  // Initialize email sync worker (requires Redis)
  try {
    await initEmailSyncWorker();
  } catch (err) {
    console.warn('Email sync worker init failed:', err.message);
  }

  // Initialize agent queue worker (requires Redis)
  try {
    initAgentWorker();
  } catch (err) {
    console.warn('Agent worker init failed:', err.message);
  }

  // Initialize sequence worker
  try {
    initSequenceWorker();
  } catch (err) {
    console.warn('Sequence worker init failed:', err.message);
  }

  // Initialize enrichment worker (requires Redis)
  try {
    require('./workers/enrichmentWorker');
    console.log('Enrichment worker initialized');
  } catch (err) {
    console.warn('Enrichment worker init failed:', err.message);
  }
});

// Serve React client in production
if (process.env.NODE_ENV === 'production') {
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
