import React, { useState, useEffect } from 'react';
import './RedditLeads.css';

const RedditLeads = () => {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [bySubreddit, setBySubreddit] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState({ status: 'new', minRelevance: 0.5 });
  const [searchParams, setSearchParams] = useState({
    subreddits: ['startups', 'smallbusiness', 'SaaS', 'entrepreneur'],
    keywords: ['need crm', 'looking for crm', 'crm solution'],
  });
  const [selectedLead, setSelectedLead] = useState(null);

  // Fetch leads
  useEffect(() => {
    fetchLeads();
    fetchStats();
  }, [filter]);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: filter.status,
        minRelevance: filter.minRelevance,
        limit: 50,
      });

      const res = await fetch(`/api/reddit-leads?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      setLeads(data.leads);
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/reddit-leads/stats/summary', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      setStats(data);

      const subRes = await fetch('/api/reddit-leads/stats/by-subreddit', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const subData = await subRes.json();
      setBySubreddit(subData);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleSearch = async () => {
    setSearching(true);
    try {
      const res = await fetch('/api/reddit-leads/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          subreddits: searchParams.subreddits,
          keywords: searchParams.keywords,
          minRelevance: filter.minRelevance,
        }),
      });

      const data = await res.json();
      if (data.success) {
        alert(`Found ${data.discovered} leads, stored ${data.stored} new leads`);
        fetchLeads();
        fetchStats();
      }
    } catch (error) {
      console.error('Error searching:', error);
      alert('Search failed: ' + error.message);
    } finally {
      setSearching(false);
    }
  };

  const handleStatusChange = async (leadId, newStatus) => {
    try {
      const res = await fetch(`/api/reddit-leads/${leadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      const updatedLead = await res.json();
      setLeads(leads.map((l) => (l.id === leadId ? updatedLead : l)));
      fetchStats();
    } catch (error) {
      console.error('Error updating lead:', error);
    }
  };

  const handleDelete = async (leadId) => {
    if (!window.confirm('Mark this lead as rejected?')) return;

    try {
      await fetch(`/api/reddit-leads/${leadId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });

      setLeads(leads.filter((l) => l.id !== leadId));
      fetchStats();
    } catch (error) {
      console.error('Error deleting lead:', error);
    }
  };

  const relevanceColor = (score) => {
    if (score >= 0.8) return '#10b981';
    if (score >= 0.6) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div className="reddit-leads-container">
      <h1>🔍 Reddit Lead Finder</h1>

      {/* Stats */}
      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.total_leads}</div>
            <div className="stat-label">Total Leads</div>
          </div>
          <div className="stat-card highlight">
            <div className="stat-value">{stats.new_leads}</div>
            <div className="stat-label">New Leads</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.contacted_leads}</div>
            <div className="stat-label">Contacted</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.converted_leads}</div>
            <div className="stat-label">Converted</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{(stats.avg_relevance * 100).toFixed(0)}%</div>
            <div className="stat-label">Avg Relevance</div>
          </div>
        </div>
      )}

      {/* By Subreddit */}
      {bySubreddit.length > 0 && (
        <div className="subreddit-breakdown">
          <h3>Leads by Subreddit</h3>
          <div className="subreddit-list">
            {bySubreddit.map((sub) => (
              <div key={sub.subreddit} className="subreddit-item">
                <div className="subreddit-name">r/{sub.subreddit}</div>
                <div className="subreddit-stats">
                  <span>{sub.total} leads</span>
                  <span className="new-badge">{sub.new_count} new</span>
                  <span className="relevance-badge">
                    {(sub.avg_relevance * 100).toFixed(0)}% avg
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Controls */}
      <div className="search-panel">
        <h3>🔎 Search Reddit</h3>

        <div className="search-config">
          <div className="form-group">
            <label>Subreddits (comma-separated)</label>
            <input
              type="text"
              value={searchParams.subreddits.join(', ')}
              onChange={(e) =>
                setSearchParams({
                  ...searchParams,
                  subreddits: e.target.value.split(',').map((s) => s.trim()),
                })
              }
              placeholder="startups, smallbusiness, SaaS"
            />
          </div>

          <div className="form-group">
            <label>Keywords (comma-separated)</label>
            <input
              type="text"
              value={searchParams.keywords.join(', ')}
              onChange={(e) =>
                setSearchParams({
                  ...searchParams,
                  keywords: e.target.value.split(',').map((k) => k.trim()),
                })
              }
              placeholder="need crm, looking for crm"
            />
          </div>

          <div className="form-group">
            <label>Minimum Relevance Score</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={filter.minRelevance}
              onChange={(e) => setFilter({ ...filter, minRelevance: parseFloat(e.target.value) })}
            />
            <span className="relevance-display">{(filter.minRelevance * 100).toFixed(0)}%</span>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={searching}
            style={{ marginTop: '1rem' }}
          >
            {searching ? '🔄 Searching...' : '🚀 Search Reddit'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
        >
          <option value="new">New Leads</option>
          <option value="contacted">Contacted</option>
          <option value="converted">Converted</option>
          <option value="rejected">Rejected</option>
          <option value="all">All Leads</option>
        </select>
      </div>

      {/* Leads Table */}
      <div className="leads-table-container">
        {loading ? (
          <div className="loading">Loading leads...</div>
        ) : leads.length === 0 ? (
          <div className="empty-state">
            <p>No leads found. Click "Search Reddit" to find leads!</p>
          </div>
        ) : (
          <div className="leads-grid">
            {leads.map((lead) => (
              <div key={lead.id} className="lead-card">
                <div className="lead-header">
                  <div className="lead-info">
                    <h4 className="lead-title">{lead.post_title}</h4>
                    <a
                      href={lead.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lead-link"
                    >
                      r/{lead.subreddit} • {lead.author}
                    </a>
                  </div>
                  <div className="lead-score">
                    <div
                      className="relevance-badge"
                      style={{
                        backgroundColor: relevanceColor(lead.relevance_score),
                      }}
                    >
                      {(lead.relevance_score * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                <div className="lead-content">{lead.post_content || 'No content provided'}</div>

                <div className="lead-keywords">
                  {lead.lead_keywords &&
                    Array.isArray(lead.lead_keywords) &&
                    lead.lead_keywords.map((kw, i) => (
                      <span key={i} className="keyword-tag">
                        {kw}
                      </span>
                    ))}
                </div>

                <div className="lead-footer">
                  <select
                    value={lead.status}
                    onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                    className={`status-select status-${lead.status}`}
                  >
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="converted">Converted</option>
                    <option value="rejected">Rejected</option>
                  </select>

                  <button
                    className="btn btn-small btn-danger"
                    onClick={() => handleDelete(lead.id)}
                  >
                    ✕
                  </button>
                </div>

                {lead.contact_email && (
                  <div className="lead-contact">📧 {lead.contact_email}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RedditLeads;
