-- Migration 015: Multi-source lead tracking (Reddit + LinkedIn)
-- Renamed reddit_leads to unified_leads to support multiple sources

-- Create new unified leads table
CREATE TABLE IF NOT EXISTS unified_leads (
  id SERIAL PRIMARY KEY,
  source_id VARCHAR(500) UNIQUE NOT NULL,
  source VARCHAR(50) NOT NULL,
  author VARCHAR(255) NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  url VARCHAR(500),
  platform_handle VARCHAR(255),
  company VARCHAR(255),
  relevance_score DECIMAL(3, 2),
  lead_keywords JSONB,
  contact_email VARCHAR(255),
  contact_name VARCHAR(255),
  linkedin_url VARCHAR(500),
  status VARCHAR(50) DEFAULT 'new',
  notes TEXT,
  metadata JSONB,
  discovered_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_status CHECK (status IN ('new', 'contacted', 'converted', 'rejected', 'spam')),
  CONSTRAINT valid_source CHECK (source IN ('reddit', 'linkedin'))
);

CREATE INDEX idx_unified_leads_status ON unified_leads(status);
CREATE INDEX idx_unified_leads_source ON unified_leads(source);
CREATE INDEX idx_unified_leads_company ON unified_leads(company);
CREATE INDEX idx_unified_leads_relevance ON unified_leads(relevance_score DESC);
CREATE INDEX idx_unified_leads_author ON unified_leads(author);
CREATE INDEX idx_unified_leads_discovered ON unified_leads(discovered_at DESC);

-- Track multi-source search configurations
CREATE TABLE IF NOT EXISTS multi_source_search_configs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  sources JSONB NOT NULL,
  keywords JSONB NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  last_sync TIMESTAMP,
  sync_frequency_minutes INTEGER DEFAULT 1440,
  min_relevance_score DECIMAL(3, 2) DEFAULT 0.5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(name)
);

CREATE INDEX idx_multi_source_search_enabled ON multi_source_search_configs(enabled);
CREATE INDEX idx_multi_source_search_last_sync ON multi_source_search_configs(last_sync);

-- Track search results and analysis across all sources
CREATE TABLE IF NOT EXISTS multi_source_search_results (
  id SERIAL PRIMARY KEY,
  config_id INTEGER REFERENCES multi_source_search_configs(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL,
  search_query TEXT,
  results_count INTEGER,
  high_relevance_count INTEGER,
  sync_started_at TIMESTAMP,
  sync_completed_at TIMESTAMP,
  status VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_multi_source_search_results_config ON multi_source_search_results(config_id);
CREATE INDEX idx_multi_source_search_results_source ON multi_source_search_results(source);
CREATE INDEX idx_multi_source_search_results_completed ON multi_source_search_results(sync_completed_at DESC);

-- Drop old reddit-specific tables (keep for backward compatibility)
-- They will be migrated data to unified_leads in a future migration if needed
-- ALTER TABLE reddit_leads RENAME TO reddit_leads_v1;
-- ALTER TABLE reddit_search_configs RENAME TO reddit_search_configs_v1;
-- ALTER TABLE reddit_search_results RENAME TO reddit_search_results_v1;
