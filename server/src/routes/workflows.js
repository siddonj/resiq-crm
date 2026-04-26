const express = require('express');
const { Workflow, WorkflowExecution } = require('../models/workflow');
const auth = require('../middleware/auth');

const router = express.Router();

function getDelayDurationMinutes(action = {}) {
  const days = parseInt(action.wait_days ?? action.waitDays ?? 0, 10) || 0;
  const hours = parseInt(action.wait_hours ?? action.waitHours ?? 0, 10) || 0;
  const minutes = parseInt(action.wait_minutes ?? action.waitMinutes ?? 0, 10) || 0;

  return (days * 24 * 60) + (hours * 60) + minutes;
}

function hasInvalidDelay(actions = []) {
  return actions.some((action) => action?.type === 'delay' && getDelayDurationMinutes(action) <= 0);
}

/**
 * Middleware to authenticate token (assumes authenticateToken exists in main server)
 * This will be imported and used in index.js
 */

/**
 * GET /api/workflows
 * List all workflows for authenticated user
 */
router.get('/', auth, async (req, res) => {
  try {
    const workflows = await Workflow.findByUserId(req.user.id);
    res.json(workflows);
  } catch (err) {
    console.error('Error fetching workflows:', err);
    res.status(500).json({ error: 'Failed to fetch workflows' });
  }
});

/**
 * GET /api/workflows/:id
 * Get a single workflow
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Verify user owns this workflow
    if (workflow.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(workflow);
  } catch (err) {
    console.error('Error fetching workflow:', err);
    res.status(500).json({ error: 'Failed to fetch workflow' });
  }
});

/**
 * POST /api/workflows
 * Create a new workflow
 * Body: { name, description, triggerType, triggerConfig, actions, conditions }
 */
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, triggerType, triggerConfig, actions, conditions } = req.body;

    // Validation
    if (!name || !triggerType || !actions || !Array.isArray(actions)) {
      return res.status(400).json({
        error: 'Missing required fields: name, triggerType, actions (array)',
      });
    }

    if (actions.length === 0) {
      return res.status(400).json({ error: 'At least one action is required' });
    }

    if (hasInvalidDelay(actions)) {
      return res.status(400).json({ error: 'Delay action must be at least 1 minute' });
    }

    // Check for duplicate workflow name
    const existing = await Workflow.findByUserId(req.user.id);
    if (existing.some((w) => w.name === name)) {
      return res.status(400).json({ error: 'Workflow name already exists' });
    }

    // Create workflow
    const workflow = await Workflow.create(req.user.id, {
      name,
      description,
      triggerType,
      triggerConfig: triggerConfig || {},
      actions,
      conditions: conditions || null,
      createdBy: req.user.id,
    });

    console.log(`Created workflow ${workflow.id} for user ${req.user.id}`);
    res.json(workflow);
  } catch (err) {
    console.error('Error creating workflow:', err);
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

/**
 * PATCH /api/workflows/:id
 * Update a workflow
 */
router.patch('/:id', auth, async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Verify user owns this workflow
    if (workflow.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, description, triggerConfig, actions, conditions, enabled } = req.body;

    // Check for duplicate name if changing it
    if (name && name !== workflow.name) {
      const existing = await Workflow.findByUserId(req.user.id);
      if (existing.some((w) => w.name === name && w.id !== req.params.id)) {
        return res.status(400).json({ error: 'Workflow name already exists' });
      }
    }

    if (actions !== undefined && hasInvalidDelay(actions)) {
      return res.status(400).json({ error: 'Delay action must be at least 1 minute' });
    }

    // Update
    const updated = await Workflow.update(req.params.id, {
      name,
      description,
      triggerConfig,
      actions,
      conditions,
      enabled,
    });

    if (!updated) {
      return res.status(500).json({ error: 'Failed to update workflow' });
    }

    console.log(`Updated workflow ${req.params.id}`);
    res.json(updated);
  } catch (err) {
    console.error('Error updating workflow:', err);
    res.status(500).json({ error: 'Failed to update workflow' });
  }
});

/**
 * DELETE /api/workflows/:id
 * Delete a workflow (cascades to execution history)
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Verify user owns this workflow
    if (workflow.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const deleted = await Workflow.delete(req.params.id);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete workflow' });
    }

    console.log(`Deleted workflow ${req.params.id}`);
    res.json({ message: 'Workflow deleted' });
  } catch (err) {
    console.error('Error deleting workflow:', err);
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

/**
 * GET /api/workflows/:id/executions
 * Get execution history for a workflow
 */
router.get('/:id/executions', auth, async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Verify user owns this workflow
    if (workflow.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const executions = await WorkflowExecution.findByWorkflowId(req.params.id, limit, offset);
    const count = await WorkflowExecution.countByWorkflowId(req.params.id);

    res.json({
      executions,
      pagination: {
        total: count,
        limit,
        offset,
      },
    });
  } catch (err) {
    console.error('Error fetching workflow executions:', err);
    res.status(500).json({ error: 'Failed to fetch executions' });
  }
});

/**
 * GET /api/workflows/:id/executions/:executionId
 * Get a single execution record
 */
router.get('/:id/executions/:executionId', auth, async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Verify user owns this workflow
    if (workflow.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const execution = await WorkflowExecution.findById(req.params.executionId);
    if (!execution || execution.workflow_id !== req.params.id) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    res.json(execution);
  } catch (err) {
    console.error('Error fetching execution:', err);
    res.status(500).json({ error: 'Failed to fetch execution' });
  }
});

/**
 * POST /api/workflows/:id/test
 * Test a workflow by manually triggering it
 * Body: { triggerType, eventData }
 */
router.post('/:id/test', auth, async (req, res) => {
  try {
    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // Verify user owns this workflow
    if (workflow.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { eventData } = req.body;
    if (!eventData) {
      return res.status(400).json({ error: 'eventData required for testing' });
    }

    // Dispatch trigger (assumes workflowEngine is available in req)
    const eventDataWithUser = { ...eventData, user_id: req.user.id };
    await req.workflowEngine.dispatchTrigger(workflow.trigger_type, eventDataWithUser);

    res.json({ message: 'Workflow triggered for testing', eventData: eventDataWithUser });
  } catch (err) {
    console.error('Error testing workflow:', err);
    res.status(500).json({ error: 'Failed to test workflow' });
  }
});

module.exports = router;
