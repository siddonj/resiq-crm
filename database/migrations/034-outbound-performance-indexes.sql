-- Phase 25: Performance indexes for high-traffic outbound tables

CREATE INDEX IF NOT EXISTS idx_outbound_leads_user_status ON outbound_leads(user_id, status);
CREATE INDEX IF NOT EXISTS idx_outbound_leads_user_score ON outbound_leads(user_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_leads_user_created ON outbound_leads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_leads_dedupe ON outbound_leads(user_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_lead_events_user_type_date ON lead_source_events(user_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_source_events(lead_id);

CREATE INDEX IF NOT EXISTS idx_outbound_drafts_user_status ON outbound_drafts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_outbound_drafts_lead ON outbound_drafts(lead_id);

CREATE INDEX IF NOT EXISTS idx_outbound_sequence_enrollments_user ON outbound_sequence_enrollments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_outbound_sequence_enrollments_lead ON outbound_sequence_enrollments(lead_id, status);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_status ON outbound_campaigns(user_id, status);

CREATE INDEX IF NOT EXISTS idx_data_quality_issues_user_status ON data_quality_issues(user_id, status);
CREATE INDEX IF NOT EXISTS idx_data_quality_issues_lead ON data_quality_issues(lead_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_tasks_user_status ON linkedin_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_linkedin_tasks_lead ON linkedin_tasks(lead_id);

CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_user ON attribution_touchpoints(user_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_attribution_touchpoints_stage ON attribution_touchpoints(attribution_stage);
