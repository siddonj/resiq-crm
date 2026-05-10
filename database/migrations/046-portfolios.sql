-- Phase 10: Portfolios & Multi-Project Views

CREATE TABLE IF NOT EXISTS portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_projects (
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  PRIMARY KEY (portfolio_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolios_owner ON portfolios(owner_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_projects_portfolio ON portfolio_projects(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_projects_project ON portfolio_projects(project_id);
