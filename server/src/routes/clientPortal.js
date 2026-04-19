const express = require('express');
const multer = require('multer');
const clientAuth = require('../middleware/clientAuth');
const auth = require('../middleware/auth');
const Client = require('../models/client');
const pool = require('../models/db');
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
    const result = await pool.query(
      `SELECT DISTINCT p.* FROM proposals p
       INNER JOIN client_shared_items csi ON p.id = csi.item_id
       WHERE csi.client_id = $1 AND csi.item_type = 'proposal'
       ORDER BY p.created_at DESC`,
      [req.client.id]
    );

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
    const accessResult = await pool.query(
      `SELECT p.* FROM proposals p
       INNER JOIN client_shared_items csi ON p.id = csi.item_id
       WHERE p.id = $1 AND csi.client_id = $2 AND csi.item_type = 'proposal'`,
      [proposalId, req.client.id]
    );

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
      await pool.query(
        'UPDATE proposals SET viewed_at = NOW() WHERE id = $1',
        [proposalId]
      );
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
    const accessResult = await pool.query(
      `SELECT p.* FROM proposals p
       INNER JOIN client_shared_items csi ON p.id = csi.item_id
       WHERE p.id = $1 AND csi.client_id = $2 AND csi.item_type = 'proposal'`,
      [proposalId, req.client.id]
    );

    if (!accessResult.rows[0]) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update proposal as signed
    const result = await pool.query(
      `UPDATE proposals 
       SET status = 'signed', signature_name = $1, signed_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [signatureName.trim(), proposalId]
    );

    const proposal = result.rows[0];

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
        const dealResult = await pool.query(
          'SELECT user_id FROM deals WHERE id = $1',
          [proposal.deal_id]
        );
        if (dealResult.rows[0]) {
          const userResult = await pool.query(
            'SELECT email FROM users WHERE id = $1',
            [dealResult.rows[0].user_id]
          );
          if (userResult.rows[0]) {
            await sendProposalSignedConfirmation(
              userResult.rows[0].email,
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
    const result = await pool.query(
      `SELECT DISTINCT i.* FROM invoices i
       INNER JOIN client_shared_items csi ON i.id = csi.item_id
       WHERE csi.client_id = $1 AND csi.item_type = 'invoice'
       ORDER BY i.created_at DESC`,
      [req.client.id]
    );

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
    const accessResult = await pool.query(
      `SELECT i.* FROM invoices i
       INNER JOIN client_shared_items csi ON i.id = csi.item_id
       WHERE i.id = $1 AND csi.client_id = $2 AND csi.item_type = 'invoice'`,
      [invoiceId, req.client.id]
    );

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
    const accessResult = await pool.query(
      `SELECT i.* FROM invoices i
       INNER JOIN client_shared_items csi ON i.id = csi.item_id
       WHERE i.id = $1 AND csi.client_id = $2 AND csi.item_type = 'invoice'`,
      [invoiceId, req.client.id]
    );

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
    const result = await pool.query(
      `SELECT cf.id, cf.file_name, cf.file_size, cf.mime_type, cf.created_at, cfs.created_at as shared_at
       FROM client_files cf
       INNER JOIN client_file_shares cfs ON cf.id = cfs.file_id
       WHERE cfs.client_id = $1
       ORDER BY cfs.created_at DESC`,
      [req.client.id]
    );

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
    const accessResult = await pool.query(
      `SELECT cf.*, cfs.id as share_id FROM client_files cf
       INNER JOIN client_file_shares cfs ON cf.id = cfs.file_id
       WHERE cf.id = $1 AND cfs.client_id = $2`,
      [fileId, req.client.id]
    );

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
    const result = await pool.query(
      `SELECT id, action, metadata, created_at 
       FROM client_activities 
       WHERE client_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [req.client.id]
    );

    res.json(result.rows);
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
 * POST /api/client/files/upload
 * Employee uploads a file to share with client
 * Requires: auth, formData with file
 */
router.post('/files/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const { clientId, description } = req.body;

  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required' });
  }

  try {
    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Upload file to storage backend
    const fileInfo = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);

    // Store file metadata in database
    const result = await pool.query(
      `INSERT INTO client_files (file_name, file_path, file_size, mime_type, uploaded_by, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [req.file.originalname, fileInfo.storagePath, fileInfo.size, fileInfo.mimeType, req.user.id, description || null]
    );

    const fileId = result.rows[0].id;

    // Share file with client
    await Client.shareItem(clientId, 'file', fileId, req.user.id);

    res.status(201).json({
      success: true,
      file: {
        id: fileId,
        name: req.file.originalname,
        size: fileInfo.size,
        type: fileInfo.mimeType,
        url: fileInfo.url,
      },
    });
  } catch (err) {
    console.error('Error uploading file:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

module.exports = router;
