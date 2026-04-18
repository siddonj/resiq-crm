-- Migration: Add workflows and workflow_executions tables
-- Created for Phase 2: Workflows & Automation

-- Workflows table: stores trigger + action configurations
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,

  -- Trigger configuration
  -- Example: { "stage": "won" } for deal.stage_changed
  -- or: { "type": "prospect" } for contact.created with filter
  trigger_type TEXT NOT NULL, -- 'deal.stage_changed', 'contact.created', 'deal.created'
  trigger_config JSONB,

  -- Actions (array of JSONB)
  -- Example: [
  --   { "type": "create_task", "title": "Follow up", "due_days": 3 },
  --   { "type": "create_activity", "description": "Auto-logged" }
  -- ]
  actions JSONB NOT NULL,

  -- Conditions (optional, for advanced workflows)
  -- Example: { "type": "AND", "conditions": [ { "field": "deal_value", "op": ">", "value": 10000 } ] }
  conditions JSONB,

  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  created_by UUID REFERENCES users(id),

  CONSTRAINT unique_workflow_name_per_user UNIQUE(user_id, name)
);

-- Workflow execution history: audit trail
CREATE TABLE IF NOT EXISTS workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,

  -- Trigger event details
  trigger_event_type TEXT,
  trigger_event_data JSONB, -- { "deal_id": "...", "old_stage": "...", "new_stage": "..." }

  -- Execution result
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  error_message TEXT,

  -- Actions executed
  actions_executed JSONB, -- [ { "type": "create_task", "status": "success", "id": "task_id" } ]

  executed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled);
CREATE INDEX IF NOT EXISTS idx_workflows_trigger_type ON workflows(trigger_type);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_created_at ON workflow_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_trigger_type ON workflow_executions(trigger_event_type);

-- Grant permissions to resiq user
GRANT SELECT, INSERT, UPDATE, DELETE ON workflows TO resiq;
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_executions TO resiq;
GRANT SELECT ON TABLE information_schema.tables TO resiq;
