-- 068: Lead unification — link outbound_leads to canonical contacts/deals,
-- give contacts a dedupe key (same format as outboundUtils.computeDedupeKey),
-- and surface the outbound score on promoted contacts.

ALTER TABLE outbound_leads
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_leads_contact_id ON outbound_leads(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS outbound_score INTEGER;

-- Backfill using the same precedence as computeDedupeKey: email -> linkedin -> name+company.
UPDATE contacts SET dedupe_key = CASE
    WHEN email IS NOT NULL AND email <> '' THEN 'email:' || lower(email)
    WHEN linkedin_url IS NOT NULL AND linkedin_url <> '' THEN 'linkedin:' || linkedin_url
    ELSE 'name_company:' || lower(COALESCE(name, '')) || '|' || lower(COALESCE(company, ''))
  END
WHERE dedupe_key IS NULL;

-- Non-unique: legacy duplicates may already exist; the app enforces on insert.
CREATE INDEX IF NOT EXISTS idx_contacts_user_dedupe_key ON contacts(user_id, dedupe_key);
