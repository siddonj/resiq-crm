-- Phase 2: Expense Tracking + Vendor Management

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  tax_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  category TEXT,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  tax_amount NUMERIC(12,2) DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  expense_date DATE DEFAULT CURRENT_DATE,
  receipt_url TEXT,
  billable BOOLEAN DEFAULT FALSE,
  invoiced BOOLEAN DEFAULT FALSE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6B7280',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendors_user ON vendors(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON expenses(vendor_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_billable ON expenses(billable);
CREATE INDEX IF NOT EXISTS idx_expense_categories_user ON expense_categories(user_id);

-- Seed default categories
INSERT INTO expense_categories (user_id, name, color)
SELECT id, 'Office Supplies', '#3B82F6' FROM users LIMIT 1
ON CONFLICT DO NOTHING;
INSERT INTO expense_categories (user_id, name, color)
SELECT id, 'Travel', '#10B981' FROM users LIMIT 1
ON CONFLICT DO NOTHING;
INSERT INTO expense_categories (user_id, name, color)
SELECT id, 'Meals & Entertainment', '#F59E0B' FROM users LIMIT 1
ON CONFLICT DO NOTHING;
INSERT INTO expense_categories (user_id, name, color)
SELECT id, 'Software', '#8B5CF6' FROM users LIMIT 1
ON CONFLICT DO NOTHING;
INSERT INTO expense_categories (user_id, name, color)
SELECT id, 'Contractors', '#EC4899' FROM users LIMIT 1
ON CONFLICT DO NOTHING;
INSERT INTO expense_categories (user_id, name, color)
SELECT id, 'Marketing', '#EF4444' FROM users LIMIT 1
ON CONFLICT DO NOTHING;
INSERT INTO expense_categories (user_id, name, color)
SELECT id, 'Utilities', '#6B7280' FROM users LIMIT 1
ON CONFLICT DO NOTHING;
INSERT INTO expense_categories (user_id, name, color)
SELECT id, 'Equipment', '#14B8A6' FROM users LIMIT 1
ON CONFLICT DO NOTHING;
