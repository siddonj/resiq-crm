import React, { useState, useEffect } from 'react';
import './MultiSourceLeads.css';

function MultiSourceLeads() {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState({
    totalLeads: 0,
    newLeads: 0,
    contactedLeads: 0,
    convertedLeads: 0,
    avgRelevance: 0,
  });
  const [statsbySource, setStatsBySource] = useState({});
  const [filters, setFilters] = useState({
    status: 'all',
    source: 'all',
    minRelevance: 0.6,
  });
  const [searchConfig, setSearchConfig] = useState({
    sources: ['reddit', 'linkedin'],
    subreddits: 'startups,smallbusiness',
    keywords: 'need crm',
    minRelevance: 0.7,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load initial data
  useEffect(() => {
    loadLeads();
    loadStats();
  }, [filters]);

  const loadLeads = async () => {
    try {
      const params = new URLSearchParams();

      if (filters.status !== 'all') params.append('status', filters.status);
      if (filters.source !== 'all') params.append('source', filters.source);
      params.append('minRelevance', filters.minRelevance);

      const response = await fetch(`/api/multi-source-leads?${params}`);

      if (response.ok) {
        const data = await response.json();
        setLeads(data.leads || []);
      }
    } catch (err) {
      console.error('Error loading leads:', err);
    }
  };

  const loadStats = async () => {
    try {
      const [summaryRes, bySourceRes] = await Promise.all([
        fetch('/api/multi-source-leads/stats/summary'),
        fetch('/api/multi-source-leads/stats/by-source'),
      ]);

      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setStats({
          totalLeads: data.total_leads || 0,
          newLeads: data.new_leads || 0,
          contactedLeads: data.contacted_leads || 0,
          convertedLeads: data.converted_leads || 0,
          avgRelevance: (data.avg_relevance || 0).toFixed(2),
        });
      }

      if (bySourceRes.ok) {
        const data = await bySourceRes.json();
        setStatsBySource(data.bySource || {});
      }
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const subreddits = searchConfig.subreddits
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s);
      const keywords = searchConfig.keywords
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k);

      const response = await fetch('/api/multi-source-leads/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sources: searchConfig.sources,
          subreddits,
          keywords,
          minRelevance: parseFloat(searchConfig.minRelevance),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.message || 'Search failed');
      }

      const data = await response.json();
      setLeads(data.leads || []);
      await loadStats();
    } catch (err) {
      setError(err.message);
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateLeadStatus = async (leadId, newStatus) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/multi-source-leads/${leadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      // Reload leads
      loadLeads();
      loadStats();
    } catch (err) {
      console.error('Error updating lead:', err);
    }
  };

  const deleteLead = async (leadId) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/multi-source-leads/${leadId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      loadLeads();
      loadStats();
    } catch (err) {
      console.error('Error deleting lead:', err);
    }
  };

  const getRelevanceColor = (score) => {
    if (score >= 0.8) return '#10b981';
    if (score >= 0.6) return '#f59e0b';
    return '#ef4444';
  };

  const getSourceIcon = (source) => {
    return source === 'reddit' ? '🔴' : '💼';
  };

  return (
    <div className="multi-source-leads">
      <div className="leads-container">
        {/* Header */}
        <div className="leads-header">
          <h1>🌐 Multi-Source Lead Finder</h1>
          <p>Search Reddit & LinkedIn for qualified leads</p>
        </div>

        {/* Stats Dashboard */}
        <div className="stats-dashboard">
          <div className="stat-card">
            <div className="stat-value">{stats.totalLeads}</div>
            <div className="stat-label">Total Leads</div>
          </div>
          <div className="stat-card new">
            <div className="stat-value">{stats.newLeads}</div>
            <div className="stat-label">New</div>
          </div>
          <div className="stat-card contacted">
            <div className="stat-value">{stats.contactedLeads}</div>
            <div className="stat-label">Contacted</div>
          </div>
          <div className="stat-card converted">
            <div className="stat-value">{stats.convertedLeads}</div>
            <div className="stat-label">Converted</div>
          </div>
          <div className="stat-card relevance">
            <div className="stat-value">{stats.avgRelevance}</div>
            <div className="stat-label">Avg Relevance</div>
          </div>
        </div>

        {/* Source Breakdown */}
        {Object.keys(statsbySource).length > 0 && (
          <div className="source-breakdown">
            <h3>📊 By Source</h3>
            <div className="source-stats">
              {Object.entries(statsbySource).map(([source, data]) => (
                <div key={source} className="source-stat">
                  <div className="source-icon">{getSourceIcon(source)}</div>
                  <div className="source-info">
                    <div className="source-name">
                      {source === 'reddit' ? 'Reddit' : 'LinkedIn'}
                    </div>
                    <div className="source-metrics">
                      <span>{data.total_leads} leads</span>
                      <span>{data.new_leads} new</span>
                      <span>{(data.avg_relevance || 0).toFixed(2)} avg</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search Configuration */}
        <div className="search-panel">
          <h2>🔎 Configure Search</h2>
          <form onSubmit={handleSearch}>
            <div className="form-group">
              <label>Sources</label>
              <div className="source-checkboxes">
                <label>
                  <input
                    type="checkbox"
                    checked={searchConfig.sources.includes('reddit')}
                    onChange={(e) => {
                      const sources = e.target.checked
                        ? [...searchConfig.sources, 'reddit']
                        : searchConfig.sources.filter((s) => s !== 'reddit');
                      setSearchConfig({ ...searchConfig, sources });
                    }}
                  />
                  🔴 Reddit
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={searchConfig.sources.includes('linkedin')}
                    onChange={(e) => {
                      const sources = e.target.checked
                        ? [...searchConfig.sources, 'linkedin']
                        : searchConfig.sources.filter((s) => s !== 'linkedin');
                      setSearchConfig({ ...searchConfig, sources });
                    }}
                  />
                  💼 LinkedIn
                </label>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Subreddits (comma-separated)</label>
                <input
                  type="text"
                  value={searchConfig.subreddits}
                  onChange={(e) =>
                    setSearchConfig({
                      ...searchConfig,
                      subreddits: e.target.value,
                    })
                  }
                  placeholder="startups, smallbusiness, SaaS"
                />
              </div>

              <div className="form-group">
                <label>Keywords (comma-separated)</label>
                <input
                  type="text"
                  value={searchConfig.keywords}
                  onChange={(e) =>
                    setSearchConfig({
                      ...searchConfig,
                      keywords: e.target.value,
                    })
                  }
                  placeholder="need crm, customer management"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Minimum Relevance Score: {searchConfig.minRelevance}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={searchConfig.minRelevance}
                onChange={(e) =>
                  setSearchConfig({
                    ...searchConfig,
                    minRelevance: parseFloat(e.target.value),
                  })
                }
              />
            </div>

            <button type="submit" disabled={loading} className="btn-search">
              {loading ? '⏳ Searching...' : '🚀 Search Both Sources'}
            </button>
          </form>

          {error && <div className="error-message">{error}</div>}
        </div>

        {/* Filters */}
        <div className="filters-bar">
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="all">All Status</option>
            <option value="new">New Leads</option>
            <option value="contacted">Contacted</option>
            <option value="converted">Converted</option>
            <option value="rejected">Rejected</option>
          </select>

          <select
            value={filters.source}
            onChange={(e) => setFilters({ ...filters, source: e.target.value })}
          >
            <option value="all">All Sources</option>
            <option value="reddit">🔴 Reddit</option>
            <option value="linkedin">💼 LinkedIn</option>
          </select>
        </div>

        {/* Leads Grid */}
        {leads.length === 0 ? (
          <div className="empty-state">
            <p>🎯 No leads found. Configure search and click "🚀 Search Both Sources"</p>
          </div>
        ) : (
          <div className="leads-grid">
            {leads.map((lead) => (
              <div key={lead.id} className="lead-card">
                <div className="lead-header">
                  <div className="lead-source">
                    {getSourceIcon(lead.source)} {lead.source.toUpperCase()}
                  </div>
                  <div className="lead-relevance" style={{ color: getRelevanceColor(lead.relevanceScore) }}>
                    📍 {(lead.relevanceScore * 100).toFixed(0)}%
                  </div>
                </div>

                <h3 className="lead-title">{lead.title}</h3>
                <p className="lead-author">{lead.source === 'reddit' ? `u/${lead.author}` : lead.author}</p>

                {lead.company && <p className="lead-company">🏢 {lead.company}</p>}

                <div className="lead-footer">
                  <select
                    value={lead.status}
                    onChange={(e) => updateLeadStatus(lead.id, e.target.value)}
                    className={`status-dropdown status-${lead.status}`}
                  >
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="converted">Converted</option>
                    <option value="rejected">Rejected</option>
                  </select>

                  <button
                    onClick={() => deleteLead(lead.id)}
                    className="btn-delete"
                    title="Delete lead"
                  >
                    ×
                  </button>
                </div>

                {lead.email && (
                  <div className="lead-contact">📧 {lead.email}</div>
                )}

                {lead.linkedinUrl && (
                  <div className="lead-contact">
                    <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer">
                      💼 View LinkedIn
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MultiSourceLeads;
