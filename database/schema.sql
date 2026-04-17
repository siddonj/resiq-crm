CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

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
  warmth_score INTEGER DEFAULT 3 CHECK (warmth_score BETWEEN 1 AND 5),
  last_contacted_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TYPE service_line AS ENUM (
  'managed_wifi',
  'proptech_selection',
  'fractional_it',
  'vendor_rfp',
  'ai_automation',
  'team_process'
);

CREATE TABLE deals (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  service_line service_line NOT NULL,
  stage VARCHAR(30) NOT NULL CHECK (stage IN ('lead','qualified','proposal','active','closed_won','closed_lost')),
  value NUMERIC(10,2),
  expected_close_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE activities (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('call','email','meeting','linkedin','note')),
  summary TEXT,
  occurred_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE reminders (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  remind_at TIMESTAMP NOT NULL,
  message TEXT,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
