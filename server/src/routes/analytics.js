const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/analytics/contacts/summary
 * Get contact metrics: total, by type, by tag, with email, new this month
 */
router.get('/contacts/summary', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN type = 'prospect' THEN 1 END) as prospects,
        COUNT(CASE WHEN type = 'partner' THEN 1 END) as partners,
        COUNT(CASE WHEN type = 'vendor' THEN 1 END) as vendors,
        COUNT(DISTINCT CASE WHEN id IN (SELECT DISTINCT contact_id FROM emails WHERE contact_id IS NOT NULL) THEN id END) as with_email,
        COUNT(CASE WHEN created_at >= DATE_TRUNC('month', NOW()) THEN 1 END) as new_this_month
      FROM contacts
      WHERE user_id = $1`,
      [req.user.id]
    );

    const summary = result.rows[0];

    // Get top tags by contact count
    const tagsResult = await pool.query(
      `SELECT t.name, COUNT(DISTINCT ct.contact_id) as count
       FROM tags t
       LEFT JOIN contact_tags ct ON t.id = ct.tag_id
       WHERE t.user_id = $1
       GROUP BY t.id, t.name
       ORDER BY count DESC
       LIMIT 5`,
      [req.user.id]
    );

    res.json({
      total: parseInt(summary.total),
      by_type: {
        prospect: parseInt(summary.prospects),
        partner: parseInt(summary.partners),
        vendor: parseInt(summary.vendors),
      },
      with_email: parseInt(summary.with_email),
      new_this_month: parseInt(summary.new_this_month),
      top_tags: tagsResult.rows.map(row => ({
        name: row.name,
        count: parseInt(row.count),
      })),
    });
  } catch (err) {
    console.error('Error fetching contacts summary:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/analytics/deals/summary
 * Get deal metrics: active, closed won/lost, pipeline value, win rate, average value
 */
router.get('/deals/summary', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(CASE WHEN stage NOT IN ('closed_won', 'closed_lost') THEN 1 END) as active_count,
        COUNT(CASE WHEN stage = 'closed_won' THEN 1 END) as closed_won,
        COUNT(CASE WHEN stage = 'closed_lost' THEN 1 END) as closed_lost,
        COALESCE(SUM(CASE WHEN stage NOT IN ('closed_won', 'closed_lost') THEN value ELSE 0 END), 0) as pipeline_value,
        COALESCE(SUM(CASE WHEN stage = 'closed_won' THEN value ELSE 0 END), 0) as closed_won_value,
        COALESCE(AVG(CASE WHEN stage NOT IN ('closed_won', 'closed_lost') THEN value END), 0) as avg_active_value
      FROM deals
      WHERE user_id = $1`,
      [req.user.id]
    );

    const summary = result.rows[0];
    const totalClosed = parseInt(summary.closed_won) + parseInt(summary.closed_lost);
    const winRate = totalClosed > 0 ? (parseInt(summary.closed_won) / totalClosed) * 100 : 0;

    res.json({
      active_count: parseInt(summary.active_count),
      closed_won: parseInt(summary.closed_won),
      closed_lost: parseInt(summary.closed_lost),
      pipeline_value: parseFloat(summary.pipeline_value),
      closed_won_value: parseFloat(summary.closed_won_value),
      avg_active_value: parseFloat(summary.avg_active_value),
      win_rate: parseFloat(winRate.toFixed(2)),
    });
  } catch (err) {
    console.error('Error fetching deals summary:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/analytics/deals/by-stage
 * Get deals breakdown by stage with metrics
 */
router.get('/deals/by-stage', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        stage,
        COUNT(*) as count,
        COALESCE(SUM(value), 0) as total_value,
        COALESCE(AVG(value), 0) as avg_value,
        MIN(created_at) as oldest_date
      FROM deals
      WHERE user_id = $1
      GROUP BY stage
      ORDER BY CASE stage
        WHEN 'lead' THEN 1 WHEN 'qualified' THEN 2 WHEN 'proposal' THEN 3
        WHEN 'active' THEN 4 WHEN 'closed_won' THEN 5 WHEN 'closed_lost' THEN 6
      END`,
      [req.user.id]
    );

    res.json(result.rows.map(row => ({
      stage: row.stage,
      count: parseInt(row.count),
      total_value: parseFloat(row.total_value),
      avg_value: parseFloat(row.avg_value),
      oldest_date: row.oldest_date,
    })));
  } catch (err) {
    console.error('Error fetching deals by stage:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/analytics/emails/summary
 * Get email activity metrics
 */
router.get('/emails/summary', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN is_outbound = true THEN 1 END) as outbound,
        COUNT(CASE WHEN is_outbound = false THEN 1 END) as inbound,
        COUNT(CASE WHEN received_at >= NOW() - INTERVAL '7 days' THEN 1 END) as last_7_days,
        COUNT(DISTINCT contact_id) as contacts_emailed
      FROM emails
      WHERE user_id = $1`,
      [req.user.id]
    );

    const summary = result.rows[0];
    const total = parseInt(summary.total);

    res.json({
      total,
      outbound: parseInt(summary.outbound),
      inbound: parseInt(summary.inbound),
      last_7_days: parseInt(summary.last_7_days),
      contacts_emailed: parseInt(summary.contacts_emailed),
      inbound_outbound_ratio: total > 0 ? parseFloat(((parseInt(summary.inbound) / total) * 100).toFixed(2)) : 0,
    });
  } catch (err) {
    console.error('Error fetching emails summary:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/analytics/emails/top-contacts
 * Get top emailed contacts with engagement metrics
 */
router.get('/emails/top-contacts', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        c.id,
        c.name,
        COUNT(e.id) as email_count,
        COUNT(DISTINCT e.gmail_thread_id) as thread_count,
        MAX(e.received_at) as last_email_date
      FROM contacts c
      LEFT JOIN emails e ON c.id = e.contact_id AND e.user_id = $1
      WHERE c.user_id = $1
      GROUP BY c.id, c.name
      HAVING COUNT(e.id) > 0
      ORDER BY email_count DESC
      LIMIT 10`,
      [req.user.id]
    );

    res.json(result.rows.map(row => ({
      contact_id: row.id,
      contact_name: row.name,
      email_count: parseInt(row.email_count),
      thread_count: parseInt(row.thread_count),
      last_email_date: row.last_email_date,
    })));
  } catch (err) {
    console.error('Error fetching top contacts:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/analytics/workflows/summary
 * Get workflow automation metrics
 */
router.get('/workflows/summary', auth, async (req, res) => {
  try {
    // Get workflow counts
    const workflowsResult = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN enabled = true THEN 1 END) as enabled,
        COUNT(CASE WHEN enabled = false THEN 1 END) as disabled
      FROM workflows
      WHERE user_id = $1`,
      [req.user.id]
    );

    // Get execution metrics for current month
    const executionsResult = await pool.query(
      `SELECT
        COUNT(*) as total_executions,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
      FROM workflow_executions we
      JOIN workflows w ON w.id = we.workflow_id
      WHERE w.user_id = $1
        AND executed_at >= DATE_TRUNC('month', NOW())`,
      [req.user.id]
    );

    const workflows = workflowsResult.rows[0];
    const executions = executionsResult.rows[0];
    const completed = parseInt(executions.completed) + parseInt(executions.failed);
    const successRate = completed > 0 ? ((parseInt(executions.completed) / completed) * 100) : 0;

    res.json({
      workflows: {
        total: parseInt(workflows.total),
        enabled: parseInt(workflows.enabled),
        disabled: parseInt(workflows.disabled),
      },
      executions_this_month: {
        total: parseInt(executions.total_executions),
        completed: parseInt(executions.completed),
        failed: parseInt(executions.failed),
        pending: parseInt(executions.pending),
        success_rate: parseFloat(successRate.toFixed(2)),
      },
    });
  } catch (err) {
    console.error('Error fetching workflows summary:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/analytics/engagement/summary
 * Get engagement tracking metrics: open rates by asset type
 */
router.get('/engagement/summary', auth, async (req, res) => {
  try {
    // Get engagement metrics by asset type
    const result = await pool.query(
      `SELECT
        asset_type,
        COUNT(*) as total_tracked,
        COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as total_opened,
        ROUND(100.0 * COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) / COUNT(*), 2) as open_rate
      FROM engagement_tracking
      WHERE user_id = $1
      GROUP BY asset_type
      ORDER BY total_tracked DESC`,
      [req.user.id]
    );

    // Get overall metrics
    const overallResult = await pool.query(
      `SELECT
        COUNT(*) as total_tracked,
        COUNT(DISTINCT contact_id) as contacts_tracked,
        COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as total_opened,
        COUNT(DISTINCT CASE WHEN opened_at IS NOT NULL THEN contact_id END) as contacts_opened
      FROM engagement_tracking
      WHERE user_id = $1`,
      [req.user.id]
    );

    const overall = overallResult.rows[0];
    const totalTracked = parseInt(overall.total_tracked);
    const overallOpenRate = totalTracked > 0 
      ? parseFloat(((parseInt(overall.total_opened) / totalTracked) * 100).toFixed(2))
      : 0;

    res.json({
      overall: {
        total_tracked: totalTracked,
        total_opened: parseInt(overall.total_opened),
        open_rate: overallOpenRate,
        contacts_tracked: parseInt(overall.contacts_tracked),
        contacts_opened: parseInt(overall.contacts_opened),
      },
      by_asset_type: result.rows.map(row => ({
        asset_type: row.asset_type,
        total_tracked: parseInt(row.total_tracked),
        total_opened: parseInt(row.total_opened),
        open_rate: parseFloat(row.open_rate),
      })),
    });
  } catch (err) {
    console.error('Error fetching engagement summary:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/analytics/engagement/top-assets
 * Get top assets by engagement (open count)
 */
router.get('/engagement/top-assets', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        asset_type,
        asset_id,
        COUNT(*) as total_tracked,
        COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as opened,
        ROUND(100.0 * COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) / COUNT(*), 2) as open_rate,
        MAX(opened_at) as last_opened
      FROM engagement_tracking
      WHERE user_id = $1
      GROUP BY asset_type, asset_id
      HAVING COUNT(*) > 0
      ORDER BY opened DESC
      LIMIT 10`,
      [req.user.id]
    );

    res.json(result.rows.map(row => ({
      asset_type: row.asset_type,
      asset_id: row.asset_id,
      total_tracked: parseInt(row.total_tracked),
      opened: parseInt(row.opened),
      open_rate: parseFloat(row.open_rate),
      last_opened: row.last_opened,
    })));
  } catch (err) {
    console.error('Error fetching top assets:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
