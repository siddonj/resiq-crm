const Queue = require('bull');
const pool = require('../models/db');
const { WorkflowExecution } = require('../models/workflow');

// Create Bull queue for workflow action execution
const workflowQueue = new Queue('workflow-execution', process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Process workflow actions (create_task, create_activity, etc.)
 */
workflowQueue.process(2, async (job) => {
  const { executionId, workflowId, action, eventData } = job.data;

  try {
    console.log(`[WorkflowWorker] Executing action for workflow ${workflowId}:`, action.type);

    let result;
    switch (action.type) {
      case 'create_task':
        result = await executeCreateTask(action, eventData);
        break;

      case 'create_activity':
        result = await executeCreateActivity(action, eventData);
        break;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }

    // Update execution record with success
    if (executionId) {
      const execution = await WorkflowExecution.findById(executionId);
      const actionsExecuted = execution.actions_executed || [];
      actionsExecuted.push({
        type: action.type,
        status: 'success',
        result_id: result.id,
      });

      await WorkflowExecution.update(executionId, {
        status: 'completed',
        actionsExecuted,
        executedAt: new Date(),
      });
    }

    console.log(`[WorkflowWorker] Action executed successfully:`, result);
    return result;
  } catch (err) {
    console.error(`[WorkflowWorker] Action execution failed:`, err);

    // Update execution record with failure
    if (executionId) {
      const execution = await WorkflowExecution.findById(executionId);
      const actionsExecuted = execution.actions_executed || [];
      actionsExecuted.push({
        type: action.type,
        status: 'failed',
        error: err.message,
      });

      await WorkflowExecution.update(executionId, {
        status: 'failed',
        errorMessage: err.message,
        actionsExecuted,
      });
    }

    throw err; // Bull will retry with backoff
  }
});

/**
 * Create a task based on action config
 */
async function executeCreateTask(action, eventData) {
  const {
    title,
    description = 'Auto-created by workflow',
    dueDate = null,
    dueDays = null,
    status = 'open',
  } = action;

  // Calculate due_date from due_days if needed
  let calculatedDueDate = dueDate;
  if (dueDays && !dueDate) {
    const due = new Date();
    due.setDate(due.getDate() + dueDays);
    calculatedDueDate = due.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  const result = await pool.query(
    `INSERT INTO tasks (contact_id, deal_id, title, description, status, due_date, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     RETURNING id, contact_id, deal_id, title, due_date, status, created_at`,
    [
      eventData.contact_id || null,
      eventData.deal_id || null,
      title,
      description,
      status,
      calculatedDueDate,
    ]
  );

  return result.rows[0];
}

/**
 * Create an activity record based on action config
 */
async function executeCreateActivity(action, eventData) {
  const { description = 'Auto-created by workflow', type = 'workflow_action' } = action;

  const result = await pool.query(
    `INSERT INTO activities (contact_id, deal_id, type, description, created_at)
     VALUES ($1, $2, $3, $4, now())
     RETURNING id, contact_id, deal_id, type, description, created_at`,
    [eventData.contact_id || null, eventData.deal_id || null, type, description]
  );

  return result.rows[0];
}

/**
 * Event handlers
 */
workflowQueue.on('completed', (job) => {
  console.log(`✅ Workflow action completed for job ${job.id}`);
});

workflowQueue.on('failed', (job, err) => {
  console.error(`❌ Workflow action failed for job ${job.id}: ${err.message}`);
});

workflowQueue.on('error', (err) => {
  console.error('[WorkflowWorker] Queue error:', err);
});

/**
 * Initialize workflow queue worker
 */
async function initWorkflowQueueWorker() {
  try {
    await workflowQueue.isReady();
    console.log('[WorkflowWorker] Workflow queue ready');
  } catch (err) {
    console.error('[WorkflowWorker] Failed to initialize workflow queue:', err);
  }
}

/**
 * Clean up queue on shutdown
 */
process.on('SIGTERM', async () => {
  console.log('[WorkflowWorker] Closing workflow queue...');
  await workflowQueue.close();
});

module.exports = {
  workflowQueue,
  initWorkflowQueueWorker,
};
