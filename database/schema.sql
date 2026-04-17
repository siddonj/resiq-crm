-- Users (CRM users / Josh + any future team)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Contacts (Prospects + Partners/Vendors)
CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL CHECK (type IN ('prospect', 'partner', 'vendor')),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(150),
  phone VARCHAR(30),
  company VARCHAR(150),
  title VARCHAR(150),
  linkedin_url TEXT,
  linkedin_imported_at TIMESTAMP,
  warmth_score INTEGER DEFAULT 3 CHECK (warmth_score BETWEEN 1 AND 5),
  last_contacted_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Service lines
CREATE TYPE service_line AS ENUM (
  'managed_wifi',
  'proptech_selection',
  'fractional_it',
  'vendor_rfp',
  'ai_automation',
  'team_process'
);

-- Deals / Pipeline
CREATE TABLE deals (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  service_line service_line NOT NULL,
  stage VARCHAR(30) NOT NULL CHECK (stage IN ('lead', 'qualified', 'proposal', 'active', 'closed_won', 'closed_lost')),
  value NUMERIC(10, 2),
  expected_close_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Activity log (calls, emails, meetings, LinkedIn touches)
CREATE TABLE activities (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'linkedin', 'note')),
  summary TEXT,
  occurred_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Follow-up reminders
CREATE TABLE reminders (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  remind_at TIMESTAMP NOT NULL,
  message TEXT,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_contacts_type ON contacts(type);
CREATE INDEX idx_contacts_warmth ON contacts(warmth_score);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_deals_service_line ON deals(service_line);
CREATE INDEX idx_activities_contact ON activities(contact_id);
CREATE INDEX idx_reminders_remind_at ON reminders(remind_at);
