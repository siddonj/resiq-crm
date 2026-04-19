-- Migration: Add client portal tables
-- Phase 14: Client Portal

-- Clients table: Portal users (separate from employees)
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT,
  first_login_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client invitations: one-time-use tokens for passwordless signup
CREATE TABLE IF NOT EXISTS client_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES clients(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client access to deals/contacts (for visibility control)
CREATE TABLE IF NOT EXISTS client_deal_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, deal_id)
);

-- Track which proposals/invoices are shared with clients
CREATE TABLE IF NOT EXISTS client_shared_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('proposal', 'invoice', 'file')),
  item_id UUID NOT NULL,
  shared_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client activity log for audit trail
CREATE TABLE IF NOT EXISTS client_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'viewed_proposal', 'signed_proposal', 'viewed_invoice', 'paid_invoice', 'downloaded_file', 'logged_in'
  metadata JSONB DEFAULT '{}', -- { proposal_id, invoice_id, file_id, payment_amount, etc }
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shared files for clients (documents, resources, etc)
CREATE TABLE IF NOT EXISTS client_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_file_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES client_files(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  shared_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(file_id, client_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug);
CREATE INDEX IF NOT EXISTS idx_clients_is_active ON clients(is_active);
CREATE INDEX IF NOT EXISTS idx_client_invitations_email ON client_invitations(email);
CREATE INDEX IF NOT EXISTS idx_client_invitations_token ON client_invitations(token);
CREATE INDEX IF NOT EXISTS idx_client_invitations_created_by ON client_invitations(created_by);
CREATE INDEX IF NOT EXISTS idx_client_deal_access_client_id ON client_deal_access(client_id);
CREATE INDEX IF NOT EXISTS idx_client_deal_access_deal_id ON client_deal_access(deal_id);
CREATE INDEX IF NOT EXISTS idx_client_shared_items_client_id ON client_shared_items(client_id);
CREATE INDEX IF NOT EXISTS idx_client_shared_items_item_type ON client_shared_items(item_type);
CREATE INDEX IF NOT EXISTS idx_client_activities_client_id ON client_activities(client_id);
CREATE INDEX IF NOT EXISTS idx_client_activities_deal_id ON client_activities(deal_id);
CREATE INDEX IF NOT EXISTS idx_client_activities_created_at ON client_activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_file_shares_client_id ON client_file_shares(client_id);
CREATE INDEX IF NOT EXISTS idx_client_file_shares_file_id ON client_file_shares(file_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO resiq;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_invitations TO resiq;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_deal_access TO resiq;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_shared_items TO resiq;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_activities TO resiq;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_files TO resiq;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_file_shares TO resiq;
