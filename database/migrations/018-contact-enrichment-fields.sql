-- Migration 018: Add dedicated enrichment fields to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_website TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_size TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enrichment_source TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_industry ON contacts(industry);
CREATE INDEX IF NOT EXISTS idx_contacts_enriched_at ON contacts(enriched_at);
