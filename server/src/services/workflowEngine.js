const { Workflow, WorkflowExecution } = require('../models/workflow');

/**
 * WorkflowEngine: Core workflow trigger dispatch and execution
 *
 * Responsibilities:
 * 1. Dispatch trigger events (e.g., deal.stage_changed)
 * 2. Find matching workflows
 * 3. Evaluate conditions
 * 4. Queue actions via Bull
 */
class WorkflowEngine {
  constructor(workflowQueue) {
    this.queue = workflowQueue;
  }

  /**
   * Dispatch a trigger event and execute matching workflows
   * @param {string} triggerType - e.g. 'deal.stage_changed', 'contact.created'
   * @param {object} eventData - Event context, e.g. { deal_id, contact_id, old_stage, new_stage, user_id }
   */
  async dispatchTrigger(triggerType, eventData) {
    try {
      console.log(`[WorkflowEngine] Dispatching trigger: ${triggerType}`, eventData);

      // Find all workflows matching this trigger type
      const workflows = await Workflow.findByTrigger(triggerType);
      console.log(`[WorkflowEngine] Found ${workflows.length} enabled workflows for trigger: ${triggerType}`);

      if (workflows.length === 0) {
        return; // No workflows to execute
      }

      // For each matching workflow, check conditions and queue actions
      for (const workflow of workflows) {
        try {
          // Evaluate conditions (if any)
          if (workflow.conditions && !this._evaluateConditions(workflow.conditions, eventData)) {
            console.log(`[WorkflowEngine] Workflow ${workflow.id} conditions not met, skipping`);
            continue;
          }

          // Create execution record
          const execution = await WorkflowExecution.create({
            workflowId: workflow.id,
            triggerEventType: triggerType,
            triggerEventData: eventData,
            status: 'processing',
          });

          console.log(`[WorkflowEngine] Created execution ${execution.id} for workflow ${workflow.id}`);

          // Queue each action (supports delay/wait nodes by shifting downstream actions)
          const actionsQueued = [];
          let cumulativeDelayMs = 0;

          for (let index = 0; index < workflow.actions.length; index += 1) {
            const action = workflow.actions[index];
            try {
              const jobData = {
                executionId: execution.id,
                workflowId: workflow.id,
                action,
                eventData,
                actionIndex: index,
                totalActions: workflow.actions.length,
              };

              const job = await this.queue.add(jobData, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                delay: cumulativeDelayMs,
                removeOnComplete: true,
              });

              console.log(`[WorkflowEngine] Queued action job ${job.id} for workflow ${workflow.id}`);
              actionsQueued.push({
                type: action.type,
                jobId: job.id,
                status: 'queued',
                delayMs: cumulativeDelayMs,
              });

              if (action.type === 'delay') {
                cumulativeDelayMs += this._getActionDelayMs(action);
              }
            } catch (err) {
              console.error(`[WorkflowEngine] Failed to queue action`, err);
              actionsQueued.push({
                type: action.type,
                status: 'failed',
                error: err.message,
              });
            }
          }

          // Update execution with queued actions
          await WorkflowExecution.update(execution.id, {
            status: 'pending',
            actionsExecuted: actionsQueued,
          });
        } catch (err) {
          console.error(`[WorkflowEngine] Error processing workflow ${workflow.id}:`, err);
        }
      }
    } catch (err) {
      console.error(`[WorkflowEngine] Error dispatching trigger:`, err);
    }
  }

  /**
   * Evaluate workflow conditions against event data
   * Supports: AND, OR, NOT + field comparisons
   * @private
   */
  _evaluateConditions(conditions, eventData) {
    if (!conditions) return true;

    if (conditions.type === 'AND') {
      return conditions.conditions.every((cond) => this._evaluateCondition(cond, eventData));
    }

    if (conditions.type === 'OR') {
      return conditions.conditions.some((cond) => this._evaluateCondition(cond, eventData));
    }

    if (conditions.type === 'NOT') {
      return !this._evaluateCondition(conditions.condition, eventData);
    }

    // Single condition
    return this._evaluateCondition(conditions, eventData);
  }

  /**
   * Evaluate a single condition
   * @private
   */
  _evaluateCondition(condition, eventData) {
    const { field, op, value } = condition;
    const fieldValue = this._getFieldValue(field, eventData);

    switch (op) {
      case '=':
      case '==':
        return fieldValue === value;
      case '!=':
      case '<>':
        return fieldValue !== value;
      case '>':
        return fieldValue > value;
      case '>=':
        return fieldValue >= value;
      case '<':
        return fieldValue < value;
      case '<=':
        return fieldValue <= value;
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue);
      case 'contains':
        // Support both string and array containment
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(value);
        }
        return typeof fieldValue === 'string' && fieldValue.includes(value);
      default:
        console.warn(`[WorkflowEngine] Unknown condition operator: ${op}`);
        return false;
    }
  }

  /**
   * Get field value from event data (supports nested paths like "deal.value")
   * @private
   */
  _getFieldValue(path, obj) {
    return path.split('.').reduce((current, part) => (current || {})[part], obj);
  }

  /**
   * Compute delay duration for a delay action in milliseconds.
   * Accepts both snake_case and camelCase forms for compatibility.
   * @private
   */
  _getActionDelayMs(action) {
    const days = parseInt(action.wait_days ?? action.waitDays ?? action.delay_days ?? action.delayDays ?? 0, 10) || 0;
    const hours = parseInt(action.wait_hours ?? action.waitHours ?? 0, 10) || 0;
    const minutes = parseInt(action.wait_minutes ?? action.waitMinutes ?? 0, 10) || 0;

    return (((days * 24) + hours) * 60 + minutes) * 60 * 1000;
  }
}

module.exports = WorkflowEngine;
