const express = require('express');
const auth = require('../middleware/auth');
const pool = require('../models/db');
const Client = require('../models/client');
const { sendProposalSentEmail, sendInvoiceSentEmail } = require('../services/clientNotifications');

const router = express.Router();

/**
 * POST /api/clients
 * Employee creates/invites a new client
 * Body: { email, name, dealId? }
 */
router.post('/', auth, async (req, res) => {
  // TODO: Check user role (admin or manager)
  const { email, name, dealId } = req.body;

  if (!email?.trim() || !name?.trim()) {
    return res.status(400).json({ error: 'email and name are required' });
  }

  try {
    // Check if client exists
    const existing = await Client.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Client already exists with this email' });
    }

    // Create invitation
    const invitation = await Client.createInvitation(email.toLowerCase(), req.user.id);

    // If dealId provided, grant access
    if (dealId) {
      try {
        const deal = await pool.query('SELECT id FROM deals WHERE id = $1', [dealId]);
        if (deal.rows[0]) {
          // We'll grant access after client is created, for now just note it
        }
      } catch (err) {
        console.warn('Could not verify deal:', err.message);
      }
    }

    res.status(201).json({
      success: true,
      invitation: { id: invitation.id, email },
    });
  } catch (err) {
    console.error('Error creating client invitation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/clients
 * List all clients (employee view)
 */
router.get('/', auth, async (req, res) => {
  // TODO: Check user role (admin or manager)
  try {
    const result = await pool.query(
      `SELECT id, name, email, slug, is_active, first_login_at, last_login_at, created_at
       FROM clients
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/clients/:clientId
 * Get client details (employee view)
 */
router.get('/:clientId', auth, async (req, res) => {
  const { clientId } = req.params;

  try {
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get client's accessible deals
    const dealsResult = await pool.query(
      `SELECT d.id, d.title, d.stage, d.value, d.created_at
       FROM deals d
       INNER JOIN client_deal_access cda ON d.id = cda.deal_id
       WHERE cda.client_id = $1
       ORDER BY d.created_at DESC`,
      [clientId]
    );

    // Get shared items count
    const sharedResult = await pool.query(
      `SELECT item_type, COUNT(*) as count
       FROM client_shared_items
       WHERE client_id = $1
       GROUP BY item_type`,
      [clientId]
    );

    const sharedItems = {};
    sharedResult.rows.forEach(row => {
      sharedItems[row.item_type] = parseInt(row.count);
    });

    res.json({
      ...client,
      password_hash: undefined, // Don't expose password
      accessibleDeals: dealsResult.rows,
      sharedItems,
    });
  } catch (err) {
    console.error('Error fetching client:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PATCH /api/clients/:clientId
 * Update client details (name, phone, etc)
 */
router.patch('/:clientId', auth, async (req, res) => {
  const { clientId } = req.params;
  const { name, phone } = req.body;

  try {
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (name?.trim()) {
      updates.push(`name = $${paramIndex}`);
      params.push(name.trim());
      paramIndex++;
    }

    if (phone?.trim()) {
      updates.push(`phone = $${paramIndex}`);
      params.push(phone.trim());
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(clientId);

    const result = await pool.query(
      `UPDATE clients SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/clients/:clientId/grant-access
 * Grant client access to a deal
 * Body: { dealId }
 */
router.post('/:clientId/grant-access', auth, async (req, res) => {
  const { clientId } = req.params;
  const { dealId } = req.body;

  if (!dealId) {
    return res.status(400).json({ error: 'dealId is required' });
  }

  try {
    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Verify deal exists
    const deal = await pool.query('SELECT id FROM deals WHERE id = $1', [dealId]);
    if (!deal.rows[0]) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    // Grant access
    await Client.grantDealAccess(clientId, dealId, req.user.id);

    res.json({ success: true, message: 'Client granted access to deal' });
  } catch (err) {
    console.error('Error granting access:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/clients/:clientId/revoke-access/:dealId
 * Revoke client access to a deal
 */
router.delete('/:clientId/revoke-access/:dealId', auth, async (req, res) => {
  const { clientId, dealId } = req.params;

  try {
    const revoked = await Client.revokeDealAccess(clientId, dealId);
    if (!revoked) {
      return res.status(404).json({ error: 'Access record not found' });
    }

    res.json({ success: true, message: 'Access revoked' });
  } catch (err) {
    console.error('Error revoking access:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/clients/:clientId/share-item
 * Share a proposal, invoice, or file with client
 * Body: { itemType: 'proposal' | 'invoice' | 'file', itemId }
 */
router.post('/:clientId/share-item', auth, async (req, res) => {
  const { clientId } = req.params;
  const { itemType, itemId } = req.body;

  if (!itemType || !itemId) {
    return res.status(400).json({ error: 'itemType and itemId are required' });
  }

  if (!['proposal', 'invoice', 'file'].includes(itemType)) {
    return res.status(400).json({ error: 'Invalid itemType' });
  }

  try {
    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Share item
    await Client.shareItem(clientId, itemType, itemId, req.user.id);

    // If proposal or invoice, update sent_at and send email notification
    if (itemType === 'proposal') {
      const result = await pool.query(
        `UPDATE proposals SET sent_at = NOW(), status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END
         WHERE id = $1 AND sent_at IS NULL
         RETURNING title`,
        [itemId]
      );
      
      // Send email notification to client
      if (result.rows[0]) {
        try {
          await sendProposalSentEmail(client.email, client.name, result.rows[0].title);
        } catch (emailErr) {
          console.warn('Failed to send proposal email:', emailErr.message);
        }
      }
    } else if (itemType === 'invoice') {
      const result = await pool.query(
        `UPDATE invoices SET sent_at = NOW(), status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END
         WHERE id = $1 AND sent_at IS NULL
         RETURNING line_items, due_date`,
        [itemId]
      );
      
      // Send email notification to client
      if (result.rows[0]) {
        try {
          const amount = result.rows[0].line_items.reduce((sum, item) => sum + (item.amount || 0), 0);
          await sendInvoiceSentEmail(client.email, client.name, itemId, amount, result.rows[0].due_date);
        } catch (emailErr) {
          console.warn('Failed to send invoice email:', emailErr.message);
        }
      }
    }

    res.json({ success: true, message: `${itemType} shared with client` });
  } catch (err) {
    console.error('Error sharing item:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/clients/:clientId/activity
 * Get activity log for a client (employee view)
 */
router.get('/:clientId/activity', auth, async (req, res) => {
  const { clientId } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, action, metadata, created_at
       FROM client_activities
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [clientId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching client activity:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/clients/:clientId
 * Deactivate a client (employee action)
 */
router.delete('/:clientId', auth, async (req, res) => {
  const { clientId } = req.params;

  try {
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    await Client.deactivate(clientId);

    res.json({ success: true, message: 'Client deactivated' });
  } catch (err) {
    console.error('Error deactivating client:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
