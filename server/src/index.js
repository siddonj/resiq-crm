require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const contactsRoutes = require('./routes/contacts');
const dealsRoutes = require('./routes/deals');
const workflowsRoutes = require('./routes/workflows');
const integrationsRoutes = require('./routes/integrations');
const analyticsRoutes = require('./routes/analytics');
const usersRoutes = require('./routes/users');
const teamsRoutes = require('./routes/teams');
const { initEmailSyncWorker } = require('./workers/emailSyncWorker');
const { workflowQueue, initWorkflowQueueWorker } = require('./workers/workflowQueueWorker');
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
app.use('/api/contacts', contactsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/teams', teamsRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, async () => {
  console.log(`ResiQ CRM server running on port ${PORT}`);

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
