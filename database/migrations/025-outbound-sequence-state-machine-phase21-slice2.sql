-- Migration 025: Phase 21 Slice 2 - Outbound sequence state machine v2

CREATE TABLE IF NOT EXISTS outbound_sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES outbound_leads(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  current_step INTEGER NOT NULL DEFAULT 1,
  next_step_due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pause_reason TEXT,
  stop_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_transition_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_outbound_sequence_enrollments_status CHECK (
    status IN ('active', 'paused', 'stopped', 'completed', 'error')
  ),
  CONSTRAINT chk_outbound_sequence_enrollments_current_step CHECK (current_step >= 1)
);

CREATE INDEX IF NOT EXISTS idx_outbound_sequence_enrollments_user_status
  ON outbound_sequence_enrollments(user_id, status, next_step_due_at);

CREATE INDEX IF NOT EXISTS idx_outbound_sequence_enrollments_lead
  ON outbound_sequence_enrollments(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_sequence_enrollments_sequence
  ON outbound_sequence_enrollments(sequence_id, created_at DESC);

-- Enforce one in-flight enrollment per lead (active or paused).
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_sequence_enrollments_one_open_per_lead
  ON outbound_sequence_enrollments(user_id, lead_id)
  WHERE status IN ('active', 'paused');

CREATE TABLE IF NOT EXISTS outbound_sequence_enrollment_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES outbound_sequence_enrollments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_state VARCHAR(20),
  to_state VARCHAR(20) NOT NULL,
  reason TEXT,
  trigger_source VARCHAR(40) NOT NULL DEFAULT 'manual',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_sequence_transitions_enrollment
  ON outbound_sequence_enrollment_transitions(enrollment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_sequence_transitions_user
  ON outbound_sequence_enrollment_transitions(user_id, created_at DESC);
