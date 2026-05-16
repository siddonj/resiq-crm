const express = require('express');
const multer = require('multer');
const clientAuth = require('../middleware/clientAuth');
const auth = require('../middleware/auth');
const Client = require('../models/client');
const { db, sql } = require('../db');
const { sendProposalSignedConfirmation, sendInvoicePaidConfirmation, sendProposalSentEmail, sendInvoiceSentEmail } = require('../services/clientNotifications');
const { uploadFile, downloadFile, deleteFile, getSignedUrl } = require('../services/fileStorage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * GET /api/client/proposals
 * List all proposals shared with authenticated client
 */
router.get('/proposals', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await sql`
      SELECT DISTINCT p.* FROM proposals p
      INNER JOIN client_shared_items csi ON p.id = csi.item_id
      WHERE csi.client_id = ${req.client.id} AND csi.item_type = 'proposal'
      ORDER BY p.created_at DESC
    `.execute(db);

    // Log view activity
    await Client.logActivity(
      req.client.id,
      'viewed_proposals_list',
      { count: result.rows.length },
      req.ip
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching client proposals:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/client/proposals/:proposalId
 * View single proposal details
 */
router.get('/proposals/:proposalId', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { proposalId } = req.params;

  try {
    // Check if client has access to this proposal
    const accessResult = await sql`
      SELECT p.* FROM proposals p
      INNER JOIN client_shared_items csi ON p.id = csi.item_id
      WHERE p.id = ${proposalId} AND csi.client_id = ${req.client.id} AND csi.item_type = 'proposal'
    `.execute(db);

    if (!accessResult.rows[0]) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const proposal = accessResult.rows[0];

    // Log view activity
    await Client.logActivity(
      req.client.id,
      'viewed_proposal',
      { proposal_id: proposalId, status: proposal.status },
      req.ip
    );

    // Update viewed_at if not already viewed
    if (!proposal.viewed_at) {
      await db.updateTable('proposals')
        .set({ viewed_at: sql`NOW()` })
        .where('id', '=', proposalId)
        .execute();
      proposal.viewed_at = new Date();
    }

    res.json(proposal);
  } catch (err) {
    console.error('Error fetching proposal:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PATCH /api/client/proposals/:proposalId/sign
 * Client signs proposal (mark as signed)
 * Body: { signatureName }
 */
router.patch('/proposals/:proposalId/sign', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { proposalId } = req.params;
  const { signatureName } = req.body;

  if (!signatureName?.trim()) {
    return res.status(400).json({ error: 'signatureName is required' });
  }

  try {
    // Check if client has access
    const accessResult = await sql`
      SELECT p.* FROM proposals p
      INNER JOIN client_shared_items csi ON p.id = csi.item_id
      WHERE p.id = ${proposalId} AND csi.client_id = ${req.client.id} AND csi.item_type = 'proposal'
    `.execute(db);

    if (!accessResult.rows[0]) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update proposal as signed
    const result = await db.updateTable('proposals')
      .set({
        status: 'signed',
        signature_name: signatureName.trim(),
        signed_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', proposalId)
      .returningAll()
      .executeTakeFirstOrThrow();

    const proposal = result;

    // Log activity
    await Client.logActivity(
      req.client.id,
      'signed_proposal',
      { proposal_id: proposalId, signature_name: signatureName },
      req.ip
    );

    // Send confirmation email to employee (get employee from deal if available)
    if (proposal.deal_id) {
      try {
        const dealRows = await sql`
          SELECT user_id FROM deals WHERE id = ${proposal.deal_id}
        `.execute(db).then(r => r.rows);
        if (dealRows[0]) {
          const userRows = await sql`
            SELECT email FROM users WHERE id = ${dealRows[0].user_id}
          `.execute(db).then(r => r.rows);
          if (userRows[0]) {
            await sendProposalSignedConfirmation(
              userRows[0].email,
              req.client.name,
              proposal.title,
              proposal.signed_at
            );
          }
        }
      } catch (emailErr) {
        console.warn('Failed to send signed confirmation email:', emailErr.message);
      }
    }

    res.json(proposal);
  } catch (err) {
    console.error('Error signing proposal:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/client/invoices
 * List all invoices shared with authenticated client
 */
router.get('/invoices', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await sql`
      SELECT DISTINCT i.* FROM invoices i
      INNER JOIN client_shared_items csi ON i.id = csi.item_id
      WHERE csi.client_id = ${req.client.id} AND csi.item_type = 'invoice'
      ORDER BY i.created_at DESC
    `.execute(db);

    // Log activity
    await Client.logActivity(
      req.client.id,
      'viewed_invoices_list',
      { count: result.rows.length },
      req.ip
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching client invoices:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/client/invoices/:invoiceId
 * View single invoice details
 */
router.get('/invoices/:invoiceId', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { invoiceId } = req.params;

  try {
    // Check if client has access to this invoice
    const accessResult = await sql`
      SELECT i.* FROM invoices i
      INNER JOIN client_shared_items csi ON i.id = csi.item_id
      WHERE i.id = ${invoiceId} AND csi.client_id = ${req.client.id} AND csi.item_type = 'invoice'
    `.execute(db);

    if (!accessResult.rows[0]) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const invoice = accessResult.rows[0];

    // Log view activity
    await Client.logActivity(
      req.client.id,
      'viewed_invoice',
      { invoice_id: invoiceId, status: invoice.status, amount: invoice.line_items },
      req.ip
    );

    res.json(invoice);
  } catch (err) {
    console.error('Error fetching invoice:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/client/invoices/:invoiceId/pay
 * Client initiates payment for invoice (returns Stripe payment link)
 * Body: {} (Stripe payment link should already be stored on invoice)
 */
router.post('/invoices/:invoiceId/pay', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { invoiceId } = req.params;

  try {
    // Check if client has access
    const accessResult = await sql`
      SELECT i.* FROM invoices i
      INNER JOIN client_shared_items csi ON i.id = csi.item_id
      WHERE i.id = ${invoiceId} AND csi.client_id = ${req.client.id} AND csi.item_type = 'invoice'
    `.execute(db);

    if (!accessResult.rows[0]) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const invoice = accessResult.rows[0];

    if (!invoice.stripe_payment_url) {
      return res.status(400).json({ error: 'Payment link not available for this invoice' });
    }

    // Log activity
    await Client.logActivity(
      req.client.id,
      'initiated_payment',
      { invoice_id: invoiceId },
      req.ip
    );

    // Return payment URL (client will redirect)
    res.json({
      paymentUrl: invoice.stripe_payment_url,
    });
  } catch (err) {
    console.error('Error initiating payment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/client/files
 * List all files shared with authenticated client
 */
router.get('/files', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await sql`
      SELECT cf.id, cf.file_name, cf.file_size, cf.mime_type, cf.created_at, cfs.created_at as shared_at
      FROM client_files cf
      INNER JOIN client_file_shares cfs ON cf.id = cfs.file_id
      WHERE cfs.client_id = ${req.client.id}
      ORDER BY cfs.created_at DESC
    `.execute(db);

    // Log activity
    await Client.logActivity(
      req.client.id,
      'viewed_files_list',
      { count: result.rows.length },
      req.ip
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching client files:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/client/files/:fileId/download
 * Download a shared file
 */
router.get('/files/:fileId/download', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { fileId } = req.params;

  try {
    // Check if client has access to this file
    const accessResult = await sql`
      SELECT cf.*, cfs.id as share_id FROM client_files cf
      INNER JOIN client_file_shares cfs ON cf.id = cfs.file_id
      WHERE cf.id = ${fileId} AND cfs.client_id = ${req.client.id}
    `.execute(db);

    if (!accessResult.rows[0]) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const file = accessResult.rows[0];

    // Log activity
    await Client.logActivity(
      req.client.id,
      'downloaded_file',
      { file_id: fileId, file_name: file.file_name },
      req.ip
    );

     // In a real implementation, you would:
    // 1. Check if file exists at file.file_path
    // 2. Stream the file to the client
    // 3. Set appropriate headers (Content-Type, Content-Disposition, etc)

    // Get signed URL for cloud storage or return local path
    const downloadUrl = await getSignedUrl(file.file_path);

    res.json({
      file: {
        id: file.id,
        name: file.file_name,
        size: file.file_size,
        type: file.mime_type,
        downloadUrl, // Client can redirect to this URL
      },
    });
  } catch (err) {
    console.error('Error downloading file:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/client/activity
 * Get activity log for client (what they've viewed, signed, etc)
 */
router.get('/activity', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await db.selectFrom('client_activities')
      .select(['id', 'action', 'metadata', 'created_at'])
      .where('client_id', '=', req.client.id)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();

    res.json(result);
  } catch (err) {
    console.error('Error fetching client activity:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/client/me
 * Get authenticated client's profile
 */
router.get('/me', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    res.json({
      id: req.client.id,
      name: req.client.name,
      email: req.client.email,
      slug: req.client.slug,
      phone: req.client.phone,
      firstLoginAt: req.client.first_login_at,
      lastLoginAt: req.client.last_login_at,
      createdAt: req.client.created_at,
    });
  } catch (err) {
    console.error('Error fetching client profile:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/client/tickets
 * List all tickets submitted by authenticated client
 */
router.get('/tickets', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await sql`
      SELECT 
        t.*,
        u.name AS assigned_to_name,
        COUNT(tr.id) FILTER (WHERE tr.id IS NOT NULL) as reply_count
      FROM tickets t
      LEFT JOIN users u ON u.id = t.assigned_to
      LEFT JOIN ticket_replies tr ON tr.ticket_id = t.id
      WHERE t.client_id = ${req.client.id}
      GROUP BY t.id, u.id, u.name
      ORDER BY t.created_at DESC
    `.execute(db);

    // Log activity
    await Client.logActivity(
      req.client.id,
      'viewed_tickets_list',
      { count: result.rows.length },
      req.ip
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching client tickets:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/client/tickets/:ticketId
 * View single ticket details with replies
 */
router.get('/tickets/:ticketId', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { ticketId } = req.params;

  try {
    // Check if client has access to this ticket
    const ticketRows = await sql`
      SELECT 
        t.*,
        u.name AS assigned_to_name
      FROM tickets t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.id = ${ticketId} AND t.client_id = ${req.client.id}
    `.execute(db).then(r => r.rows);

    if (ticketRows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = ticketRows[0];

    // Get replies
    const repliesResult = await sql`
      SELECT 
        tr.*,
        u.name AS user_name,
        cl.name AS client_name
      FROM ticket_replies tr
      LEFT JOIN users u ON u.id = tr.user_id
      LEFT JOIN clients cl ON cl.id = tr.client_id
      WHERE tr.ticket_id = ${ticketId}
      ORDER BY tr.created_at ASC
    `.execute(db);

    // Log activity
    await Client.logActivity(
      req.client.id,
      'viewed_ticket',
      { ticket_id: ticketId, status: ticket.status },
      req.ip
    );

    res.json({
      ticket,
      replies: repliesResult.rows,
    });
  } catch (err) {
    console.error('Error fetching ticket:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/client/tickets
 * Client submits a new support ticket
 */
router.post('/tickets', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { subject, description, priority } = req.body;

  if (!subject?.trim()) {
    return res.status(400).json({ error: 'Subject is required' });
  }

  try {
    // Get the client's associated user/contact
    const contactRows = await sql`
      SELECT c.id FROM contacts c 
      WHERE c.email = ${req.client.email} LIMIT 1
    `.execute(db).then(r => r.rows);

    const contactId = contactRows[0]?.id || null;

    // Create ticket (associate with client's manager)
    const ticketResult = await sql`
      INSERT INTO tickets (client_id, contact_id, subject, description, priority, user_id)
      VALUES (${req.client.id}, ${contactId}, ${subject}, ${description || null}, ${priority || 'medium'},
        (SELECT user_id FROM clients WHERE id = ${req.client.id}))
      RETURNING *
    `.execute(db);

    const ticket = ticketResult.rows[0];

    // Log creation activity
    await sql`
      INSERT INTO ticket_activities (ticket_id, action, details)
      VALUES (${ticket.id}, 'created_by_client', ${JSON.stringify({ client_id: req.client.id })})
    `.execute(db);

    // Log client activity
    await Client.logActivity(
      req.client.id,
      'submitted_ticket',
      { ticket_id: ticket.id, subject },
      req.ip
    );

    res.status(201).json(ticket);
  } catch (err) {
    console.error('Error creating ticket:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/client/tickets/:ticketId/replies
 * Client adds a reply to their support ticket
 */
router.post('/tickets/:ticketId/replies', clientAuth, async (req, res) => {
  if (!req.client) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { ticketId } = req.params;
  const { message } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    // Verify client owns this ticket
    const ticketCheck = await sql`
      SELECT id FROM tickets WHERE id = ${ticketId} AND client_id = ${req.client.id}
    `.execute(db).then(r => r.rows);

    if (ticketCheck.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Add reply
    const replyResult = await sql`
      INSERT INTO ticket_replies (ticket_id, client_id, message)
      VALUES (${ticketId}, ${req.client.id}, ${message})
      RETURNING *
    `.execute(db);

    // Update ticket updated_at
    await db.updateTable('tickets')
      .set({ updated_at: sql`NOW()` })
      .where('id', '=', ticketId)
      .execute();

    // Log activity
    await sql`
      INSERT INTO ticket_activities (ticket_id, action, details)
      VALUES (${ticketId}, 'client_replied', ${JSON.stringify({ client_id: req.client.id })})
    `.execute(db);

    // Log client activity
    await Client.logActivity(
      req.client.id,
      'replied_to_ticket',
      { ticket_id: ticketId },
      req.ip
    );

    res.status(201).json(replyResult.rows[0]);
  } catch (err) {
    console.error('Error adding reply:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
