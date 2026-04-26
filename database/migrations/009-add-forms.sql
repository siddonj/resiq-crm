CREATE TABLE forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  redirect_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
