const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');
const { sendTicketAssignedNotification, sendTicketReplyNotification } = require('../services/clientNotifications');

const router = express.Router();

// List tickets (with filtering)
router.get('/', auth, async (req, res) => {
  try {
    const { status, priority, assigned_to, contact_id, sort } = req.query;
    const params = [req.user.id];
    const filters = ['t.user_id = $1'];

    if (status) {
      params.push(status);
      filters.push(`t.status = $${params.length}`);
    }
    if (priority) {
      params.push(priority);
      filters.push(`t.priority = $${params.length}`);
    }
    if (assigned_to) {
      params.push(assigned_to);
      filters.push(`t.assigned_to = $${params.length}`);
    }
    if (contact_id) {
      params.push(contact_id);
      filters.push(`t.contact_id = $${params.length}`);
    }

    const filterSQL = filters.join(' AND ');
    const orderSQL = sort === 'priority' 
      ? "ORDER BY CASE WHEN t.priority = 'urgent' THEN 1 WHEN t.priority = 'high' THEN 2 WHEN t.priority = 'medium' THEN 3 ELSE 4 END, t.created_at DESC"
      : 'ORDER BY t.created_at DESC';

    const result = await pool.query(
      `SELECT 
        t.*,
        u_assigned.name AS assigned_to_name,
        c.name AS contact_name,
        cl.name AS client_name,
        COUNT(tr.id) FILTER (WHERE tr.id IS NOT NULL) as reply_count
       FROM tickets t
       LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
       LEFT JOIN contacts c ON c.id = t.contact_id
       LEFT JOIN clients cl ON cl.id = t.client_id
       LEFT JOIN ticket_replies tr ON tr.ticket_id = t.id
       WHERE ${filterSQL}
       GROUP BY t.id, u_assigned.id, u_assigned.name, c.id, c.name, cl.id, cl.name
       ${orderSQL}`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single ticket with replies
router.get('/:ticketId', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticketResult = await pool.query(
      `SELECT 
        t.*,
        u_assigned.name AS assigned_to_name,
        c.name AS contact_name,
        cl.name AS client_name
       FROM tickets t
       LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
       LEFT JOIN contacts c ON c.id = t.contact_id
       LEFT JOIN clients cl ON cl.id = t.client_id
       WHERE t.id = $1 AND t.user_id = $2`,
      [ticketId, req.user.id]
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = ticketResult.rows[0];

    // Get replies
    const repliesResult = await pool.query(
      `SELECT 
        tr.*,
        u.name AS user_name,
        cl.name AS client_name
       FROM ticket_replies tr
       LEFT JOIN users u ON u.id = tr.user_id
       LEFT JOIN clients cl ON cl.id = tr.client_id
       WHERE tr.ticket_id = $1
       ORDER BY tr.created_at ASC`,
      [ticketId]
    );

    // Get activity
    const activityResult = await pool.query(
      `SELECT 
        ta.*,
        u.name AS user_name
       FROM ticket_activities ta
       LEFT JOIN users u ON u.id = ta.user_id
       WHERE ta.ticket_id = $1
       ORDER BY ta.created_at DESC`,
      [ticketId]
    );

    res.json({
      ticket,
      replies: repliesResult.rows,
      activity: activityResult.rows,
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create ticket (from client portal or admin)
router.post('/', auth, async (req, res) => {
  try {
    const { client_id, contact_id, subject, description, priority } = req.body;

    if (!subject?.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }

    const ticketPriority = priority || 'medium';
    
    const result = await pool.query(
      `INSERT INTO tickets (user_id, client_id, contact_id, subject, description, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, client_id || null, contact_id || null, subject, description || null, ticketPriority]
    );

    const ticket = result.rows[0];

    // Log creation activity
    await pool.query(
      `INSERT INTO ticket_activities (ticket_id, user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [ticket.id, req.user.id, 'created', JSON.stringify({ subject })]
    );

    logAction(req.user.id, req.user.email, 'create', 'ticket', ticket.id, subject);

    // Broadcast new ticket to all connected Help Desk users via WebSocket
    const ticketWS = req.app.locals.ticketWS;
    if (ticketWS) {
      ticketWS.broadcastTicketCreated(ticket);
    }

    res.status(201).json(ticket);
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update ticket (status, priority, assignment)
router.patch('/:ticketId', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, priority, assigned_to } = req.body;

    // Get current ticket to check if assignment is changing
    const currentTicket = await pool.query(
      'SELECT * FROM tickets WHERE id = $1 AND user_id = $2',
      [ticketId, req.user.id]
    );

    if (currentTicket.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const oldAssignedTo = currentTicket.rows[0].assigned_to;

    // Build update query
    const updateFields = [];
    const params = [ticketId, req.user.id];

    if (status) {
      params.push(status);
      updateFields.push(`status = $${params.length}`);
    }
    if (priority) {
      params.push(priority);
      updateFields.push(`priority = $${params.length}`);
    }
    if (assigned_to !== undefined) {
      params.push(assigned_to || null);
      updateFields.push(`assigned_to = $${params.length}`);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(new Date());
    updateFields.push(`updated_at = $${params.length}`);

    if (status === 'resolved' || status === 'closed') {
      params.push(new Date());
      updateFields.push(`resolved_at = $${params.length}`);
    }

    const result = await pool.query(
      `UPDATE tickets 
       SET ${updateFields.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = result.rows[0];

    // Log activity
    const action = status ? `status_changed_to_${status}` : `updated`;
    await pool.query(
      `INSERT INTO ticket_activities (ticket_id, user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [ticketId, req.user.id, action, JSON.stringify({ status, priority, assigned_to })]
    );

    // Send assignment notification if assigned_to changed
    if (assigned_to && assigned_to !== oldAssignedTo) {
      const assignedUserResult = await pool.query(
        'SELECT email, name FROM users WHERE id = $1',
        [assigned_to]
      );
      
      if (assignedUserResult.rows[0]) {
        const assignedUser = assignedUserResult.rows[0];
        
        // Get client info
        let clientName = 'Unknown Client';
        if (ticket.client_id) {
          const clientResult = await pool.query(
            'SELECT name FROM clients WHERE id = $1',
            [ticket.client_id]
          );
          if (clientResult.rows[0]) {
            clientName = clientResult.rows[0].name;
          }
        } else if (ticket.contact_id) {
          const contactResult = await pool.query(
            'SELECT name FROM contacts WHERE id = $1',
            [ticket.contact_id]
          );
          if (contactResult.rows[0]) {
            clientName = contactResult.rows[0].name;
          }
        }

        // Send notification email
        await sendTicketAssignedNotification(
          assignedUser.email,
          assignedUser.name,
          clientName,
          ticket.subject,
          ticketId
        );
      }
    }

    logAction(req.user.id, req.user.email, 'update', 'ticket', ticketId, ticket.subject);

    // Broadcast ticket update to all connected Help Desk users via WebSocket
    const ticketWS = req.app.locals.ticketWS;
    if (ticketWS) {
      ticketWS.broadcastTicketUpdate(ticketId, ticket);
    }

    res.json(ticket);
  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add reply to ticket
router.post('/:ticketId/replies', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Verify ticket exists and user owns it
    const ticketCheck = await pool.query(
      'SELECT id FROM tickets WHERE id = $1 AND user_id = $2',
      [ticketId, req.user.id]
    );

    if (ticketCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const result = await pool.query(
      `INSERT INTO ticket_replies (ticket_id, user_id, message)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [ticketId, req.user.id, message]
    );

    // Update ticket updated_at
    await pool.query(
      'UPDATE tickets SET updated_at = NOW() WHERE id = $1',
      [ticketId]
    );

    // Log activity
    await pool.query(
      `INSERT INTO ticket_activities (ticket_id, user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [ticketId, req.user.id, 'replied', JSON.stringify({ message: message.substring(0, 100) })]
    );

    // Broadcast reply to all users viewing this ticket via WebSocket
    const ticketWS = req.app.locals.ticketWS;
    if (ticketWS) {
      ticketWS.broadcastReplyAdded(ticketId, result.rows[0]);
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding reply:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete ticket
router.delete('/:ticketId', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticketCheck = await pool.query(
      'SELECT subject FROM tickets WHERE id = $1 AND user_id = $2',
      [ticketId, req.user.id]
    );

    if (ticketCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const { subject } = ticketCheck.rows[0];

    await pool.query(
      'DELETE FROM tickets WHERE id = $1 AND user_id = $2',
      [ticketId, req.user.id]
    );

    logAction(req.user.id, req.user.email, 'delete', 'ticket', ticketId, subject);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
