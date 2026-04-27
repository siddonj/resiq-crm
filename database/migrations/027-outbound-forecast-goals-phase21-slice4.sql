-- Migration 027: Phase 21 Slice 4 - Outbound forecast and goals

CREATE TABLE IF NOT EXISTS sales_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_type VARCHAR(20) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_meetings INTEGER NOT NULL DEFAULT 0,
  target_opportunities INTEGER NOT NULL DEFAULT 0,
  target_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_sales_goals_period_type CHECK (period_type IN ('weekly', 'monthly')),
  CONSTRAINT chk_sales_goals_meetings CHECK (target_meetings >= 0),
  CONSTRAINT chk_sales_goals_opps CHECK (target_opportunities >= 0),
  CONSTRAINT chk_sales_goals_revenue CHECK (target_revenue >= 0),
  CONSTRAINT chk_sales_goals_period_range CHECK (period_end >= period_start),
  CONSTRAINT uq_sales_goals_user_period UNIQUE (user_id, period_type, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_sales_goals_user_period
  ON sales_goals(user_id, period_type, period_start DESC);

CREATE TABLE IF NOT EXISTS pipeline_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_type VARCHAR(20) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  commit_count INTEGER NOT NULL DEFAULT 0,
  best_case_count INTEGER NOT NULL DEFAULT 0,
  closed_count INTEGER NOT NULL DEFAULT 0,
  commit_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  best_case_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_forecast_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pipeline_forecasts_period_type CHECK (period_type IN ('weekly', 'monthly')),
  CONSTRAINT chk_pipeline_forecasts_period_range CHECK (period_end >= period_start),
  CONSTRAINT uq_pipeline_forecasts_snapshot UNIQUE (user_id, period_type, period_start, period_end, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_forecasts_user_period
  ON pipeline_forecasts(user_id, period_type, period_start DESC, snapshot_date DESC);
