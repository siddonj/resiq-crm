// Multi-source lead finder API routes
// Supports searching Reddit and LinkedIn for qualified leads

const express = require('express');
const db = require('../models/db');
const MultiSourceLeadService = require('../services/multiSourceLeadService');
const authMiddleware = require('../middleware/auth');
const { getSetting } = require('../services/appSettings');

const router = express.Router();

/**
 * GET /api/leads/health
 * Health check - verify database connection and table exists
 */
router.get('/health', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'unified_leads'
      ) as table_exists
    `);
    
    const hasKey = !!process.env.ANTHROPIC_API_KEY;

    res.json({
      status: 'ok',
      database: 'connected',
      tableExists: result.rows[0].table_exists,
      apiKeySet: hasKey,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      database: 'failed',
      message: err.message,
    });
  }
});

// All routes below require authentication (health check above stays public for monitoring)
router.use(authMiddleware);

/**
 * POST /api/leads/search
 * Search Reddit and LinkedIn for leads
 * Body: { sources: ['reddit', 'linkedin'], keywords: [...], subreddits: [...], minRelevance: 0.6 }
 */
router.post('/search', async (req, res) => {
  try {
    const allowSyntheticRequest = req.body.allowSynthetic === true;
    const allowSyntheticSetting = Boolean(await getSetting('allow_synthetic_leads'));
    if (!allowSyntheticRequest || !allowSyntheticSetting) {
      return res.status(410).json({
        error: 'Synthetic lead generation is disabled',
        message: 'Use /api/outbound/leads/import/csv for real lead ingestion.',
      });
    }

    const {
      sources = ['reddit', 'linkedin'],
      subreddits = ['startups', 'smallbusiness'],
      keywords = [],
      minRelevance = 0.5,
    } = req.body;

    console.log('[MultiSourceLeads] Search request:', {
      sources,
      subreddits,
      keywords,
      minRelevance,
      apiKeySet: !!process.env.ANTHROPIC_API_KEY,
    });

    if (!keywords.length) {
      return res.status(400).json({
        error: 'keywords array required',
      });
    }

    // Build configs for search
    const configs = subreddits.map((sub) => ({
      subreddit: sub,
      keywords,
    }));

    // Search all sources
    console.log('[MultiSourceLeads] Starting search with configs:', configs);
    const leads = await MultiSourceLeadService.searchAllSources(configs);
    console.log('[MultiSourceLeads] Search completed, found leads:', leads.length);

    // Filter by relevance
    const filtered = leads.filter((l) => l.relevanceScore >= minRelevance);

    // Store in database
    const stored = [];
    for (const lead of filtered) {
      try {
        const result = await db.query(
          `INSERT INTO unified_leads
           (source_id, source, author, title, content, url, company, relevance_score,
            lead_keywords, contact_email, contact_name, linkedin_url, discovered_at, metadata, is_synthetic, lead_source_confidence, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, TRUE, 5, $14)
           ON CONFLICT (source_id) DO UPDATE SET
             status = EXCLUDED.status,
             updated_at = NOW()
           RETURNING *`,
          [
            lead.sourceId,
            lead.source,
            lead.author || lead.name,
            lead.title,
            lead.content,
            lead.sourceUrl,
            lead.company,
            lead.relevanceScore,
            JSON.stringify(lead.keywords || []),
            lead.email,
            lead.contact_name || lead.name,
            lead.linkedinUrl,
            JSON.stringify({
              sourceId: lead.sourceId,
              source: lead.source,
              subreddit: lead.subreddit,
            }),
            req.orgId,
          ]
        );
        stored.push(result.rows[0]);
      } catch (err) {
        console.error('Error storing lead:', err);
      }
    }

    res.json({
      success: true,
      searched: {
        sources,
        subreddits,
        keywords,
      },
      results: {
        totalFound: leads.length,
        highRelevance: filtered.length,
        stored: stored.length,
      },
      leads: stored.map((lead) => ({
        id: lead.id,
        source: lead.source,
        author: lead.author,
        title: lead.title,
        company: lead.company,
        relevanceScore: lead.relevance_score,
        email: lead.contact_email,
        linkedinUrl: lead.linkedin_url,
        status: lead.status,
        discoveredAt: lead.discovered_at,
      })),
    });
  } catch (err) {
    console.error('[MultiSourceLeads] Search error:', {
      message: err.message,
      code: err.code,
      status: err.status,
      stack: err.stack,
    });
    res.status(500).json({
      error: 'Search failed',
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.toString() : undefined,
    });
  }
});

/**
 * POST /api/multi-source-leads/test-search
 * Test search without authentication (development only)
 */
router.post('/test-search', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).end();
  }
  try {
    const allowSyntheticRequest = req.body.allowSynthetic === true;
    const allowSyntheticSetting = Boolean(await getSetting('allow_synthetic_leads'));
    if (!allowSyntheticRequest || !allowSyntheticSetting) {
      return res.status(410).json({
        error: 'Synthetic lead generation is disabled',
        message: 'Use /api/outbound/leads/import/csv for real lead ingestion.',
      });
    }

    const {
      sources = ['reddit', 'linkedin'],
      subreddits = ['startups', 'smallbusiness'],
      keywords = [],
      minRelevance = 0.5,
    } = req.body;

    console.log('[MultiSourceLeads] TEST Search request:', {
      sources,
      subreddits,
      keywords,
      minRelevance,
      apiKeySet: !!process.env.ANTHROPIC_API_KEY,
    });

    if (!keywords.length) {
      return res.status(400).json({
        error: 'keywords array required',
      });
    }

    // Build configs for search
    const configs = subreddits.map((sub) => ({
      subreddit: sub,
      keywords,
    }));

    // Search all sources
    console.log('[MultiSourceLeads] TEST Starting search with configs:', configs);
    const leads = await MultiSourceLeadService.searchAllSources(configs);
    console.log('[MultiSourceLeads] TEST Search completed, found leads:', leads.length);

    // Filter by relevance
    const filtered = leads.filter((l) => l.relevanceScore >= minRelevance);

    // Store in database
    const stored = [];
    for (const lead of filtered) {
      try {
        const result = await db.query(
          `INSERT INTO unified_leads
           (source_id, source, author, title, content, url, company, relevance_score,
            lead_keywords, contact_email, contact_name, linkedin_url, discovered_at, metadata, is_synthetic, lead_source_confidence, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, TRUE, 5, $14)
           ON CONFLICT (source_id) DO UPDATE SET
             status = EXCLUDED.status,
             updated_at = NOW()
           RETURNING *`,
          [
            lead.sourceId,
            lead.source,
            lead.author || lead.name,
            lead.title,
            lead.content,
            lead.sourceUrl,
            lead.company,
            lead.relevanceScore,
            JSON.stringify(lead.keywords || []),
            lead.email,
            lead.contact_name || lead.name,
            lead.linkedinUrl,
            JSON.stringify({
              sourceId: lead.sourceId,
              source: lead.source,
              subreddit: lead.subreddit,
            }),
            req.orgId,
          ]
        );
        stored.push(result.rows[0]);
      } catch (err) {
        console.error('Error storing lead:', err);
      }
    }

    res.json({
      success: true,
      searched: {
        sources,
        subreddits,
        keywords,
      },
      results: {
        totalFound: leads.length,
        highRelevance: filtered.length,
        stored: stored.length,
      },
      leads: stored.map((lead) => ({
        id: lead.id,
        source: lead.source,
        author: lead.author,
        title: lead.title,
        company: lead.company,
        relevanceScore: lead.relevance_score,
        email: lead.contact_email,
        linkedinUrl: lead.linkedin_url,
        status: lead.status,
        discoveredAt: lead.discovered_at,
      })),
    });
  } catch (err) {
    console.error('[MultiSourceLeads] TEST Search error:', {
      message: err.message,
      code: err.code,
      status: err.status,
      stack: err.stack,
    });
    res.status(500).json({
      error: 'TEST Search failed',
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.toString() : undefined,
    });
  }
});

/**
 * GET /api/leads
 * List leads with filters
 * Query: ?status=new&source=reddit&minRelevance=0.6
 */
router.get('/', async (req, res) => {
  try {
    const { status, source, minRelevance = 0 } = req.query;

    let query = 'SELECT * FROM unified_leads WHERE organization_id = $1 AND relevance_score >= $2';
    const params = [req.orgId, minRelevance];
    let paramIndex = 3;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (source) {
      query += ` AND source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }

    query += ' ORDER BY discovered_at DESC LIMIT 100';

    const result = await db.query(query, params);

    res.json({
      total: result.rows.length,
      leads: result.rows.map((lead) => ({
        id: lead.id,
        source: lead.source,
        author: lead.author,
        title: lead.title,
        company: lead.company,
        relevanceScore: lead.relevance_score,
        email: lead.contact_email,
        linkedinUrl: lead.linkedin_url,
        status: lead.status,
        discoveredAt: lead.discovered_at,
      })),
    });
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Failed to list leads' });
  }
});

/**
 * PATCH /api/leads/:id
 * Update lead status or notes
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    let query = 'UPDATE unified_leads SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += `, status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (notes) {
      query += `, notes = $${paramIndex}`;
      params.push(notes);
      paramIndex++;
    }

    query += ` WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1} RETURNING *`;
    params.push(id, req.orgId);

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = result.rows[0];
    res.json({
      id: lead.id,
      source: lead.source,
      status: lead.status,
      notes: lead.notes,
    });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

/**
 * POST /api/multi-source-leads/:id/promote-to-outbound
 * Send a social/unified lead into the outbound engine (dedup + scoring),
 * so it can be worked through campaigns/sequences like any other lead.
 */
router.post('/:id/promote-to-outbound', async (req, res) => {
  try {
    const { id } = req.params;
    const { computeDedupeKey } = require('../utils/outboundUtils');
    const { scoreLead } = require('../services/outboundScoring');

    const result = await db.query(
      `SELECT * FROM unified_leads WHERE id = $1 AND organization_id = $2`,
      [id, req.orgId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    const source = result.rows[0];

    const candidate = {
      name: source.contact_name || source.author,
      email: source.contact_email || null,
      company: source.company || null,
      title: null,
      linkedin_url: source.linkedin_url || null,
      website: null,
      location: null,
      phone: null,
      notes: source.notes || null,
    };
    const dedupeKey = computeDedupeKey(candidate);

    const existing = await db.query(
      `SELECT id FROM outbound_leads WHERE user_id = $1 AND dedupe_key = $2`,
      [req.user.id, dedupeKey]
    );
    if (existing.rows.length) {
      return res.status(200).json({ outboundLeadId: existing.rows[0].id, duplicate: true });
    }

    const score = scoreLead(candidate);
    const inserted = await db.query(
      `INSERT INTO outbound_leads
        (user_id, organization_id, source_type, source_reference, source_confidence, is_synthetic,
         name, email, company, linkedin_url, notes, raw_data, dedupe_key,
         fit_score, intent_score, total_score, status, next_recommended_action)
       VALUES ($1, $2, 'other', $3, $4, FALSE, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        req.user.id, req.orgId, `unified_lead:${source.source}:${source.id}`,
        Math.round(Number(source.relevance_score || 0) * 100),
        candidate.name, candidate.email, candidate.company, candidate.linkedin_url,
        candidate.notes, JSON.stringify(source), dedupeKey,
        score.fitScore, score.intentScore, score.totalScore, score.status, score.nextRecommendedAction,
      ]
    );

    await db.query(
      `UPDATE unified_leads SET status = 'converted', updated_at = NOW() WHERE id = $1`,
      [source.id]
    );

    res.status(201).json({ outboundLeadId: inserted.rows[0].id, score: score.totalScore, status: score.status });
  } catch (err) {
    console.error('Promote-to-outbound error:', err);
    res.status(500).json({ error: 'Failed to promote lead' });
  }
});

/**
 * DELETE /api/leads/:id
 * Delete/reject a lead
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'UPDATE unified_leads SET status = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3 RETURNING id',
      ['rejected', id, req.orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({ success: true, deletedId: id });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

/**
 * GET /api/leads/stats/summary
 * Get overall lead stats across all sources
 */
router.get('/stats/summary', async (req, res) => {
  try {
    const stats = await db.query(
      `SELECT
        COUNT(*) as total_leads,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
        SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted_leads,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted_leads,
        AVG(relevance_score) as avg_relevance,
        COUNT(DISTINCT source) as sources_count
      FROM unified_leads
      WHERE organization_id = $1`,
      [req.orgId]
    );

    res.json(stats.rows[0]);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /api/leads/stats/by-source
 * Get lead stats broken down by source (Reddit vs LinkedIn)
 */
router.get('/stats/by-source', async (req, res) => {
  try {
    const stats = await db.query(
      `SELECT
        source,
        COUNT(*) as total_leads,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
        SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted_leads,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted_leads,
        AVG(relevance_score) as avg_relevance,
        COUNT(DISTINCT company) as unique_companies
      FROM unified_leads
      WHERE organization_id = $1
      GROUP BY source
      ORDER BY total_leads DESC`,
      [req.orgId]
    );

    res.json({
      bySource: stats.rows.reduce((acc, row) => {
        acc[row.source] = row;
        return acc;
      }, {}),
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

module.exports = router;
