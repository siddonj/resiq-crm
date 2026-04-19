-- Migration: Add SMS integration tables and columns
-- Phase 15: SMS Integration via Twilio

-- SMS Messages: Store all SMS (sent/received)
CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'read')),
  phone_from TEXT NOT NULL,
  phone_to TEXT NOT NULL,
  twilio_message_sid TEXT UNIQUE,
  error_message TEXT,
  delivery_time TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS Templates: Pre-built and custom templates with variables
CREATE TABLE IF NOT EXISTS sms_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  variables TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS Opt-outs: Track contacts who opted out of SMS
CREATE TABLE IF NOT EXISTS sms_optouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  reason TEXT CHECK (reason IN ('manual', 'stop_keyword', 'bounce', 'complaint')),
  opted_out_at TIMESTAMPTZ DEFAULT NOW(),
  opted_out_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id)
);

-- Update contacts table: Add SMS-related columns
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opted_in BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opted_in_at TIMESTAMPTZ;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sms_messages_contact_id ON sms_messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_employee_id ON sms_messages(employee_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_status ON sms_messages(status);
CREATE INDEX IF NOT EXISTS idx_sms_messages_created_at ON sms_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_sms_templates_slug ON sms_templates(slug);
CREATE INDEX IF NOT EXISTS idx_sms_optouts_contact_id ON sms_optouts(contact_id);
CREATE INDEX IF NOT EXISTS idx_sms_optouts_phone ON sms_optouts(phone_number);

-- Insert default SMS templates
INSERT INTO sms_templates (name, slug, content, description, is_default, variables, created_by)
VALUES
  (
    'Proposal Sent',
    'proposal_sent',
    'Hi {{firstName}}, check out our proposal for {{dealName}}: {{proposalLink}} (expires {{expiryDate}})',
    'Sent when a proposal is shared with a client',
    TRUE,
    ARRAY['firstName', 'dealName', 'proposalLink', 'expiryDate'],
    NULL
  ),
  (
    'Invoice Due',
    'invoice_due',
    'Invoice {{invoiceNumber}} for {{amount}} is due on {{dueDate}}: {{paymentLink}}. Reply STOP to opt-out.',
    'Sent when an invoice is due',
    TRUE,
    ARRAY['invoiceNumber', 'amount', 'dueDate', 'paymentLink'],
    NULL
  ),
  (
    'Meeting Reminder',
    'meeting_reminder',
    'Reminder: {{meetingTitle}} at {{meetingTime}} on {{meetingDate}}',
    'Sent to remind about upcoming meetings',
    TRUE,
    ARRAY['meetingTitle', 'meetingTime', 'meetingDate'],
    NULL
  ),
  (
    'Payment Confirmed',
    'payment_confirmed',
    'Thanks {{firstName}}! We received your payment of {{amount}} for invoice {{invoiceNumber}}. Your receipt is available at {{receiptLink}}',
    'Sent when payment is received',
    TRUE,
    ARRAY['firstName', 'amount', 'invoiceNumber', 'receiptLink'],
    NULL
  ),
  (
    'Quote Expiring Soon',
    'quote_expiring',
    'Hi {{firstName}}, your quote for {{dealName}} expires in {{daysUntilExpiry}} days. Review it here: {{quoteLink}}',
    'Sent when a quote is about to expire',
    TRUE,
    ARRAY['firstName', 'dealName', 'daysUntilExpiry', 'quoteLink'],
    NULL
  );
