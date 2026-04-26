const pool = require('./db');

class Workflow {
  // Create a new workflow
  static async create(userId, { name, description, triggerType, triggerConfig, actions, conditions, createdBy }) {
    const triggerConfigJson = JSON.stringify(triggerConfig || {});
    const actionsJson = JSON.stringify(actions || []);
    const conditionsJson = conditions == null ? null : JSON.stringify(conditions);

    const result = await pool.query(
      `INSERT INTO workflows (user_id, name, description, trigger_type, trigger_config, actions, conditions, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
       RETURNING *`,
      [userId, name, description, triggerType, triggerConfigJson, actionsJson, conditionsJson, createdBy]
    );
    return result.rows[0];
  }

  // Get all workflows for a user
  static async findByUserId(userId) {
    const result = await pool.query(
      'SELECT * FROM workflows WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  }

  // Get a single workflow by ID
  static async findById(id) {
    const result = await pool.query('SELECT * FROM workflows WHERE id = $1', [id]);
    return result.rows[0];
  }

  // Get all enabled workflows matching a trigger type
  static async findByTrigger(triggerType) {
    const result = await pool.query(
      'SELECT * FROM workflows WHERE trigger_type = $1 AND enabled = true',
      [triggerType]
    );
    return result.rows;
  }

  // Update workflow
  static async update(id, { name, description, triggerConfig, actions, conditions, enabled, updatedAt = new Date() }) {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (triggerConfig !== undefined) {
      updates.push(`trigger_config = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(triggerConfig || {}));
    }
    if (actions !== undefined) {
      updates.push(`actions = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(actions || []));
    }
    if (conditions !== undefined) {
      updates.push(`conditions = $${paramIndex++}::jsonb`);
      values.push(conditions == null ? null : JSON.stringify(conditions));
    }
    if (enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      values.push(enabled);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(updatedAt);

    values.push(id);

    if (updates.length === 1) return null; // Only updated_at, no changes

    const result = await pool.query(
      `UPDATE workflows SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  // Delete workflow
  static async delete(id) {
    const result = await pool.query('DELETE FROM workflows WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  // Count workflows for a user
  static async countByUserId(userId) {
    const result = await pool.query('SELECT COUNT(*) FROM workflows WHERE user_id = $1', [userId]);
    return parseInt(result.rows[0].count, 10);
  }
}

class WorkflowExecution {
  // Create execution record
  static async create({
    workflowId,
    triggerEventType,
    triggerEventData,
    status = 'pending',
    errorMessage = null,
    actionsExecuted = null,
    executedAt = null,
  }) {
    const triggerEventDataJson = JSON.stringify(triggerEventData || {});
    const actionsExecutedJson = actionsExecuted == null ? null : JSON.stringify(actionsExecuted);

    const result = await pool.query(
      `INSERT INTO workflow_executions
       (workflow_id, trigger_event_type, trigger_event_data, status, error_message, actions_executed, executed_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7)
       RETURNING *`,
      [workflowId, triggerEventType, triggerEventDataJson, status, errorMessage, actionsExecutedJson, executedAt]
    );
    return result.rows[0];
  }

  // Update execution record
  static async update(id, { status, errorMessage, actionsExecuted, executedAt = new Date() }) {
    const actionsExecutedJson = actionsExecuted == null ? null : JSON.stringify(actionsExecuted);

    const result = await pool.query(
      `UPDATE workflow_executions
       SET status = $1, error_message = $2, actions_executed = $3::jsonb, executed_at = $4
       WHERE id = $5
       RETURNING *`,
      [status, errorMessage, actionsExecutedJson, executedAt, id]
    );
    return result.rows[0];
  }

  // Get execution history for a workflow
  static async findByWorkflowId(workflowId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM workflow_executions
       WHERE workflow_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [workflowId, limit, offset]
    );
    return result.rows;
  }

  // Get execution by ID
  static async findById(id) {
    const result = await pool.query('SELECT * FROM workflow_executions WHERE id = $1', [id]);
    return result.rows[0];
  }

  // Count executions for a workflow
  static async countByWorkflowId(workflowId) {
    const result = await pool.query(
      'SELECT COUNT(*) FROM workflow_executions WHERE workflow_id = $1',
      [workflowId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  // Get recent executions (for dashboard/history view)
  static async findRecent(limit = 20) {
    const result = await pool.query(
      `SELECT we.*, w.name as workflow_name, w.user_id
       FROM workflow_executions we
       JOIN workflows w ON we.workflow_id = w.id
       ORDER BY we.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  // Get failed executions for monitoring
  static async findFailed(limit = 50) {
    const result = await pool.query(
      `SELECT we.*, w.name as workflow_name, w.user_id
       FROM workflow_executions we
       JOIN workflows w ON we.workflow_id = w.id
       WHERE we.status = 'failed'
       ORDER BY we.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
}

module.exports = {
  Workflow,
  WorkflowExecution,
};
