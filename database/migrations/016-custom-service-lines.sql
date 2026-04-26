-- Migration: Allow free-text service lines (replace ENUM with TEXT)
-- This allows users to add custom service line values beyond the predefined set.

ALTER TABLE contacts ALTER COLUMN service_line TYPE TEXT USING service_line::text;
ALTER TABLE deals ALTER COLUMN service_line TYPE TEXT USING service_line::text;

DROP TYPE IF EXISTS service_line;
