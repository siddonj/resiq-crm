// server/src/routes/emailCampaigns.js
// API routes for email campaign management

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const EmailCampaignService = require('../services/emailCampaignService');
const { db, sql } = require('../db');

// ── Templates ──────────────────────────────────────────────────────────────────

router.get('/templates', auth, async (req, res) => {
  try {
    const templates = await EmailCampaignService.listTemplates(req.user.id);
    res.json(templates);
  } catch (err) {
    console.error('Error listing templates:', err);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.post('/templates', auth, async (req, res) => {
  try {
    const { name, subject, body_html, body_text, category } = req.body;
    if (!name || !subject || !body_html) {
      return res.status(400).json({ error: 'name, subject, and body_html required' });
    }
    const template = await EmailCampaignService.createTemplate(req.user.id, req.body);
    res.json(template);
  } catch (err) {
    console.error('Error creating template:', err);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

router.put('/templates/:id', auth, async (req, res) => {
  try {
    const template = await EmailCampaignService.updateTemplate(req.params.id, req.user.id, req.body);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (err) {
    console.error('Error updating template:', err);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// ── Campaigns ──────────────────────────────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  try {
    const campaigns = await EmailCampaignService.listCampaigns(req.user.id);
    res.json(campaigns);
  } catch (err) {
    console.error('Error listing campaigns:', err);
    res.status(500).json({ error: 'Failed to list campaigns' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const campaign = await EmailCampaignService.createCampaign(req.user.id, req.body);
    res.json(campaign);
  } catch (err) {
    console.error('Error creating campaign:', err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const campaign = await EmailCampaignService.getCampaign(req.params.id, req.user.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    console.error('Error getting campaign:', err);
    res.status(500).json({ error: 'Failed to get campaign' });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const campaign = await EmailCampaignService.updateCampaign(req.params.id, req.user.id, req.body);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    console.error('Error updating campaign:', err);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await EmailCampaignService.deleteCampaign(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting campaign:', err);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// ── Actions ────────────────────────────────────────────────────────────────────

router.post('/:id/send', auth, async (req, res) => {
  try {
    const result = await EmailCampaignService.sendCampaign(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('Error sending campaign:', err);
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/schedule', auth, async (req, res) => {
  try {
    const { schedule_at } = req.body;
    if (!schedule_at) return res.status(400).json({ error: 'schedule_at required' });
    await EmailCampaignService.scheduleCampaign(req.params.id, req.user.id, schedule_at);
    res.json({ success: true });
  } catch (err) {
    console.error('Error scheduling campaign:', err);
    res.status(500).json({ error: 'Failed to schedule campaign' });
  }
});

router.post('/:id/pause', auth, async (req, res) => {
  try {
    await EmailCampaignService.pauseCampaign(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error pausing campaign:', err);
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
});

// ── Recipient Preview ──────────────────────────────────────────────────────────

router.post('/preview-segment', auth, async (req, res) => {
  try {
    const { filter } = req.body;
    const contacts = await EmailCampaignService.resolveSegment(req.user.id, filter);
    res.json({
      count: contacts.length,
      contacts: contacts.slice(0, 20), // Preview first 20
    });
  } catch (err) {
    console.error('Error previewing segment:', err);
    res.status(500).json({ error: 'Failed to preview segment' });
  }
});

module.exports = router;
