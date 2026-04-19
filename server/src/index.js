require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const clientAuthRoutes = require('./routes/clientAuth');
const clientPortalRoutes = require('./routes/clientPortal');
const clientsRoutes = require('./routes/clients');
const stripeRoutes = require('./routes/stripe');
const contactsRoutes = require('./routes/contacts');
const dealsRoutes = require('./routes/deals');
const workflowsRoutes = require('./routes/workflows');
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
const { initEmailSyncWorker } = require('./workers/emailSyncWorker');
const { workflowQueue, initWorkflowQueueWorker } = require('./workers/workflowQueueWorker');
const { MessageQueueService } = require('./services/messageQueue');
const WorkflowEngine = require('./services/workflowEngine');

const app = express();
app.use(cors());
app.use(express.json());

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

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, async () => {
  console.log(`ResiQ CRM server running on port ${PORT}`);

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
    console.warn('Email sync worker init failed (Redis may not be running):', err.message);
    console.warn('Email sync will not work until Redis is available');
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
