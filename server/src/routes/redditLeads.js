// Reddit leads API routes
// Manages Reddit-sourced lead discovery, filtering, and tracking

const express = require('express');
const db = require('../models/db');
const RedditMCPService = require('../services/redditMCPService');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Search Reddit for leads
router.post('/search', authMiddleware, async (req, res) => {
  try {
    const { subreddits = [], keywords = [], minRelevance = 0.5 } = req.body;

    if (!subreddits.length || !keywords.length) {
      return res.status(400).json({
        error: 'subreddits and keywords arrays required',
      });
    }

    // Build search configs
    const configs = subreddits.map((sub) => ({
      subreddit: sub,
      keywords,
    }));

    // Search Reddit
    const leads = await RedditMCPService.searchMultipleSubreddits(configs);

    // Filter by relevance
    const filteredLeads = leads.filter((lead) => lead.relevance_score >= minRelevance);

    // Store leads in database
    const storedLeads = [];
    for (const lead of filteredLeads) {
      try {
        const result = await db.query(
          `INSERT INTO reddit_leads (
            reddit_id, author, post_title, post_url, subreddit, 
            post_content, relevance_score, lead_keywords, contact_email, 
            contact_name, discovered_at, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (reddit_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
          RETURNING *`,
          [
            `reddit_${lead.author}_${Date.now()}`,
            lead.author,
            lead.post_title,
            lead.post_url || '',
            lead.subreddit,
            lead.post_content || JSON.stringify(lead),
            lead.relevance_score || 0,
            JSON.stringify(lead.pain_points || []),
            lead.contact_email || null,
            lead.contact_name || lead.author,
            new Date(lead.discovered_at),
            'new',
          ]
        );
        storedLeads.push(result.rows[0]);
      } catch (err) {
        console.error('Error storing lead:', err);
      }
    }

    res.json({
      success: true,
      discovered: leads.length,
      stored: storedLeads.length,
      leads: storedLeads,
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all Reddit leads
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status = 'new', subreddit, minRelevance = 0, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM reddit_leads WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    if (subreddit) {
      query += ` AND subreddit = $${params.length + 1}`;
      params.push(subreddit);
    }

    if (minRelevance > 0) {
      query += ` AND relevance_score >= $${params.length + 1}`;
      params.push(minRelevance);
    }

    query += ` ORDER BY relevance_score DESC, discovered_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit);
    params.push(offset);

    const result = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM reddit_leads WHERE 1=1';
    const countParams = [];

    if (status && status !== 'all') {
      countQuery += ` AND status = $${countParams.length + 1}`;
      countParams.push(status);
    }

    if (subreddit) {
      countQuery += ` AND subreddit = $${countParams.length + 1}`;
      countParams.push(subreddit);
    }

    const countResult = await db.query(countQuery, countParams);

    res.json({
      leads: result.rows,
      total: parseInt(countResult.rows[0].count),
      count: result.rows.length,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single lead
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM reddit_leads WHERE id = $1', [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update lead status
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const { status, notes, contact_email, contact_name } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status required' });
    }

    const result = await db.query(
      `UPDATE reddit_leads 
       SET status = $1, notes = COALESCE($2, notes), 
           contact_email = COALESCE($3, contact_email),
           contact_name = COALESCE($4, contact_name),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [status, notes || null, contact_email || null, contact_name || null, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete lead (mark as spam/rejected)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'UPDATE reddit_leads SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      ['rejected', req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({ success: true, lead: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get search configs
router.get('/configs/list', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM reddit_search_configs WHERE enabled = true ORDER BY subreddit'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update search config
router.patch('/configs/:id', authMiddleware, async (req, res) => {
  try {
    const { keywords, enabled, sync_frequency_minutes, min_relevance_score } = req.body;

    const result = await db.query(
      `UPDATE reddit_search_configs
       SET keywords = COALESCE($1, keywords),
           enabled = COALESCE($2, enabled),
           sync_frequency_minutes = COALESCE($3, sync_frequency_minutes),
           min_relevance_score = COALESCE($4, min_relevance_score),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [
        keywords ? JSON.stringify(keywords) : null,
        enabled,
        sync_frequency_minutes,
        min_relevance_score,
        req.params.id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Config not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get lead statistics
router.get('/stats/summary', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_leads,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new_leads,
        COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted_leads,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) as converted_leads,
        AVG(relevance_score) as avg_relevance,
        MAX(discovered_at) as latest_discovery
      FROM reddit_leads
    `);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leads by subreddit
router.get('/stats/by-subreddit', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        subreddit,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
        AVG(relevance_score) as avg_relevance
      FROM reddit_leads
      GROUP BY subreddit
      ORDER BY total DESC
    `);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
