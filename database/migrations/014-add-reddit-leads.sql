-- Migration 014: Add Reddit leads tracking
-- Stores leads discovered through Reddit MCP integration

CREATE TABLE IF NOT EXISTS reddit_leads (
  id SERIAL PRIMARY KEY,
  reddit_id VARCHAR(255) UNIQUE NOT NULL,
  author VARCHAR(255) NOT NULL,
  post_title TEXT NOT NULL,
  post_url VARCHAR(500) NOT NULL,
  subreddit VARCHAR(255) NOT NULL,
  post_content TEXT,
  relevance_score DECIMAL(3, 2),
  lead_keywords JSONB,
  contact_email VARCHAR(255),
  contact_name VARCHAR(255),
  source_type VARCHAR(50) DEFAULT 'reddit_post',
  status VARCHAR(50) DEFAULT 'new',
  notes TEXT,
  discovered_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_status CHECK (status IN ('new', 'contacted', 'converted', 'rejected', 'spam')),
  CONSTRAINT valid_source_type CHECK (source_type IN ('reddit_post', 'reddit_comment', 'reddit_discussion'))
);

CREATE INDEX idx_reddit_leads_status ON reddit_leads(status);
CREATE INDEX idx_reddit_leads_subreddit ON reddit_leads(subreddit);
CREATE INDEX idx_reddit_leads_relevance ON reddit_leads(relevance_score DESC);
CREATE INDEX idx_reddit_leads_author ON reddit_leads(author);
CREATE INDEX idx_reddit_leads_discovered ON reddit_leads(discovered_at DESC);

-- Track which subreddits we're monitoring
CREATE TABLE IF NOT EXISTS reddit_search_configs (
  id SERIAL PRIMARY KEY,
  subreddit VARCHAR(255) NOT NULL,
  keywords JSONB NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  last_sync TIMESTAMP,
  sync_frequency_minutes INTEGER DEFAULT 1440,
  min_relevance_score DECIMAL(3, 2) DEFAULT 0.5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(subreddit)
);

CREATE INDEX idx_reddit_search_enabled ON reddit_search_configs(enabled);
CREATE INDEX idx_reddit_search_last_sync ON reddit_search_configs(last_sync);

-- Track search results and analysis
CREATE TABLE IF NOT EXISTS reddit_search_results (
  id SERIAL PRIMARY KEY,
  config_id INTEGER REFERENCES reddit_search_configs(id) ON DELETE CASCADE,
  search_query TEXT,
  results_count INTEGER,
  high_relevance_count INTEGER,
  sync_started_at TIMESTAMP,
  sync_completed_at TIMESTAMP,
  status VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reddit_search_results_config ON reddit_search_results(config_id);
CREATE INDEX idx_reddit_search_results_completed ON reddit_search_results(sync_completed_at DESC);
