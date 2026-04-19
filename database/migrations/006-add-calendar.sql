-- Migration: Calendar events and scheduling settings
-- Phase 13: Calendar & Scheduling

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  google_event_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'google', 'booking')),
  booking_name TEXT,
  booking_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduling_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  slot_duration INTEGER NOT NULL DEFAULT 30,
  availability JSONB NOT NULL DEFAULT '{"monday":[{"start":"09:00","end":"17:00"}],"tuesday":[{"start":"09:00","end":"17:00"}],"wednesday":[{"start":"09:00","end":"17:00"}],"thursday":[{"start":"09:00","end":"17:00"}],"friday":[{"start":"09:00","end":"17:00"}]}',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  title TEXT NOT NULL DEFAULT 'Book a meeting',
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_at ON calendar_events(start_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_google_event_id ON calendar_events(google_event_id) WHERE google_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_settings_slug ON scheduling_settings(slug);

GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_events TO resiq;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling_settings TO resiq;
