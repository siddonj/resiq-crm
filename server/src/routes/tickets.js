const express = require('express');
const { db, sql, ownershipWhere } = require('../db');
const auth = require('../middleware/auth');
const { logAction } = require('../services/auditLogger');
const { sendTicketAssignedNotification, sendTicketReplyNotification } = require('../services/clientNotifications');

const router = express.Router();

// List tickets (with filtering)
router.get('/', auth, async (req, res) => {
  try {
    const { status, priority, assigned_to, contact_id, sort } = req.query;
    const conditions = [sql`t.user_id = ${req.user.id}`];

    if (status) {
      conditions.push(sql`t.status = ${status}`);
    }
    if (priority) {
      conditions.push(sql`t.priority = ${priority}`);
    }
    if (assigned_to) {
      conditions.push(sql`t.assigned_to = ${assigned_to}`);
    }
    if (contact_id) {
      conditions.push(sql`t.contact_id = ${contact_id}`);
    }

    const whereClause = sql.join(conditions, ' AND ');
    const orderSQL = sort === 'priority' 
      ? sql`ORDER BY CASE WHEN t.priority = 'urgent' THEN 1 WHEN t.priority = 'high' THEN 2 WHEN t.priority = 'medium' THEN 3 ELSE 4 END, t.created_at DESC`
      : sql`ORDER BY t.created_at DESC`;

    const { rows } = await sql`
      SELECT 
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
      WHERE ${whereClause}
      GROUP BY t.id, u_assigned.id, u_assigned.name, c.id, c.name, cl.id, cl.name
      ${orderSQL}
    `.execute(db);

    res.json(rows);
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single ticket with replies
router.get('/:ticketId', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;

    const { rows: ticketRows } = await sql`
      SELECT 
        t.*,
        u_assigned.name AS assigned_to_name,
        c.name AS contact_name,
        cl.name AS client_name
      FROM tickets t
      LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
      LEFT JOIN contacts c ON c.id = t.contact_id
      LEFT JOIN clients cl ON cl.id = t.client_id
      WHERE t.id = ${ticketId} AND t.user_id = ${req.user.id}
    `.execute(db);

    if (ticketRows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = ticketRows[0];

    // Get replies
    const { rows: replies } = await sql`
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

    // Get activity
    const { rows: activity } = await sql`
      SELECT 
        ta.*,
        u.name AS user_name
      FROM ticket_activities ta
      LEFT JOIN users u ON u.id = ta.user_id
      WHERE ta.ticket_id = ${ticketId}
      ORDER BY ta.created_at DESC
    `.execute(db);

    res.json({
      ticket,
      replies,
      activity,
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
    
    const ticket = await db.insertInto('tickets')
      .values({
        user_id: req.user.id,
        client_id: client_id || null,
        contact_id: contact_id || null,
        subject,
        description: description || null,
        priority: ticketPriority,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Log creation activity
    await db.insertInto('ticket_activities')
      .values({
        ticket_id: ticket.id,
        user_id: req.user.id,
        action: 'created',
        details: JSON.stringify({ subject }),
      })
      .execute();

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
    const currentTicket = await db.selectFrom('tickets')
      .selectAll()
      .where('id', '=', ticketId)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!currentTicket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const oldAssignedTo = currentTicket.assigned_to;

    // Build update
    const updateValues = {};
    if (status) updateValues.status = status;
    if (priority) updateValues.priority = priority;
    if (assigned_to !== undefined) updateValues.assigned_to = assigned_to || null;

    if (Object.keys(updateValues).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateValues.updated_at = new Date();

    if (status === 'resolved' || status === 'closed') {
      updateValues.resolved_at = new Date();
    }

    const ticket = await db.updateTable('tickets')
      .set(updateValues)
      .where('id', '=', ticketId)
      .where('user_id', '=', req.user.id)
      .returningAll()
      .executeTakeFirst();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Log activity
    const action = status ? `status_changed_to_${status}` : `updated`;
    await db.insertInto('ticket_activities')
      .values({
        ticket_id: ticketId,
        user_id: req.user.id,
        action,
        details: JSON.stringify({ status, priority, assigned_to }),
      })
      .execute();

    // Send assignment notification if assigned_to changed
    if (assigned_to && assigned_to !== oldAssignedTo) {
      const assignedUser = await db.selectFrom('users')
        .select(['email', 'name'])
        .where('id', '=', assigned_to)
        .executeTakeFirst();
      
      if (assignedUser) {
        // Get client info
        let clientName = 'Unknown Client';
        if (ticket.client_id) {
          const client = await db.selectFrom('clients')
            .select('name')
            .where('id', '=', ticket.client_id)
            .executeTakeFirst();
          if (client) {
            clientName = client.name;
          }
        } else if (ticket.contact_id) {
          const contact = await db.selectFrom('contacts')
            .select('name')
            .where('id', '=', ticket.contact_id)
            .executeTakeFirst();
          if (contact) {
            clientName = contact.name;
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
    const ticketCheck = await db.selectFrom('tickets')
      .select('id')
      .where('id', '=', ticketId)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!ticketCheck) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const reply = await db.insertInto('ticket_replies')
      .values({
        ticket_id: ticketId,
        user_id: req.user.id,
        message,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Update ticket updated_at
    await db.updateTable('tickets')
      .set({ updated_at: sql`NOW()` })
      .where('id', '=', ticketId)
      .execute();

    // Log activity
    await db.insertInto('ticket_activities')
      .values({
        ticket_id: ticketId,
        user_id: req.user.id,
        action: 'replied',
        details: JSON.stringify({ message: message.substring(0, 100) }),
      })
      .execute();

    // Broadcast reply to all users viewing this ticket via WebSocket
    const ticketWS = req.app.locals.ticketWS;
    if (ticketWS) {
      ticketWS.broadcastReplyAdded(ticketId, reply);
    }

    res.status(201).json(reply);
  } catch (error) {
    console.error('Error adding reply:', error);
    res.status(500).json({ error: error.message });
  }
});

// AI auto-draft suggested reply for a ticket
router.post('/:ticketId/ai-suggest', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;

    // Fetch ticket with related contact info
    const ticket = await db.selectFrom('tickets')
      .selectAll()
      .where('id', '=', ticketId)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const contextPieces = [];

    // 1. Ticket subject + description
    contextPieces.push(`TICKET SUBJECT: ${ticket.subject}`);
    if (ticket.description) {
      contextPieces.push(`TICKET DESCRIPTION: ${ticket.description}`);
    }

    // 2. Contact info and notes (if contact_id exists)
    if (ticket.contact_id) {
      const contact = await db.selectFrom('contacts')
        .select(['name', 'email', 'phone', 'company', 'notes'])
        .where('id', '=', ticket.contact_id)
        .executeTakeFirst();

      if (contact) {
        contextPieces.push(`CONTACT: ${contact.name}${contact.company ? ` (${contact.company})` : ''}${contact.email ? ` - ${contact.email}` : ''}`);
        if (contact.notes) {
          contextPieces.push(`CONTACT NOTES: ${contact.notes}`);
        }

        // 3. Recent activities for this contact
        const activities = await db.selectFrom('activities')
          .select(['type', 'description', 'occurred_at'])
          .where('contact_id', '=', ticket.contact_id)
          .orderBy('occurred_at', 'desc')
          .limit(10)
          .execute();

        if (activities.length > 0) {
          contextPieces.push('RECENT ACTIVITIES:');
          for (const act of activities) {
            contextPieces.push(`- [${act.occurred_at ? new Date(act.occurred_at).toLocaleDateString() : '?'}] ${act.type}${act.description ? `: ${act.description}` : ''}`);
          }
        }

        // 4. Deals related to this contact
        const deals = await db.selectFrom('deals')
          .select(['id', 'title', 'stage', 'value', 'notes'])
          .where('contact_id', '=', ticket.contact_id)
          .orderBy('created_at', 'desc')
          .limit(5)
          .execute();

        if (deals.length > 0) {
          contextPieces.push('RELATED DEALS:');
          for (const deal of deals) {
            contextPieces.push(`- ${deal.title} (${deal.stage})${deal.value ? ` - $${deal.value}` : ''}${deal.notes ? ` — Notes: ${deal.notes}` : ''}`);
          }

          // 5. Proposals through deals
          const dealIds = deals.map(d => d.id);
          const proposals = await db.selectFrom('proposals')
            .select(['title', 'status', 'created_at'])
            .where('deal_id', 'in', dealIds)
            .orderBy('created_at', 'desc')
            .limit(5)
            .execute();

          if (proposals.length > 0) {
            contextPieces.push('RELATED PROPOSALS:');
            for (const prop of proposals) {
              contextPieces.push(`- ${prop.title} (${prop.status}) — ${prop.created_at ? new Date(prop.created_at).toLocaleDateString() : '?'}`);
            }
          }

          // 6. Invoices through deals
          const invoices = await db.selectFrom('invoices')
            .select(['title', 'status', 'invoice_number', 'created_at'])
            .where('deal_id', 'in', dealIds)
            .orderBy('created_at', 'desc')
            .limit(5)
            .execute();

          if (invoices.length > 0) {
            contextPieces.push('RELATED INVOICES:');
            for (const inv of invoices) {
              contextPieces.push(`- ${inv.title} (#${inv.invoice_number}, ${inv.status}) — ${inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '?'}`);
            }
          }
        }
      }

      // 7. Previous ticket replies for this contact (other closed tickets)
      const prevTickets = await db.selectFrom('tickets')
        .select(['id', 'subject', 'status'])
        .where('contact_id', '=', ticket.contact_id)
        .where('id', '!=', ticketId)
        .where('user_id', '=', req.user.id)
        .orderBy('created_at', 'desc')
        .limit(5)
        .execute();

      if (prevTickets.length > 0) {
        contextPieces.push('PREVIOUS TICKETS:');
        for (const pt of prevTickets) {
          contextPieces.push(`- ${pt.subject} (${pt.status})`);
        }
      }
    }

    // 8. Current ticket replies (existing conversation)
    const existingReplies = await db.selectFrom('ticket_replies')
      .select(['message', 'created_at'])
      .where('ticket_id', '=', ticketId)
      .orderBy('created_at', 'asc')
      .limit(20)
      .execute();

    if (existingReplies.length > 0) {
      contextPieces.push('EXISTING CONVERSATION:');
      for (const reply of existingReplies) {
        const date = reply.created_at ? new Date(reply.created_at).toLocaleDateString() : '?';
        contextPieces.push(`[${date}] ${reply.message.substring(0, 500)}`);
      }
    }

    // Build the prompt
    const prompt = `You are a helpful CRM assistant for a property management company called ResiQ. 
An agent is about to reply to a support ticket. Based on the context below, draft a suggested reply.

Guidelines:
- Be professional, friendly, and helpful
- Reference relevant past interactions if they add value
- If the context indicates next steps (e.g., a proposal was sent, an invoice is due), mention them
- Keep the reply concise but thorough (2-4 paragraphs)
- Do NOT fabricate information — if context is lacking, give a generic helpful response
- Do NOT include placeholders like [Client Name] — use actual names from context
- The reply should be ready to send with minimal editing

CONTEXT:
${contextPieces.join('\n')}

DRAFT REPLY:`;

    // Call OpenAI
    const OpenAI = require('openai');
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful CRM assistant for a property management company. Generate professional, context-aware draft replies for support tickets.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const draft = completion.choices[0]?.message?.content?.trim() || '';

    if (!draft) {
      return res.status(500).json({ error: 'AI failed to generate a draft' });
    }

    res.json({ draft, model: 'gpt-4o-mini' });
  } catch (error) {
    console.error('Error generating AI draft:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete ticket
router.delete('/:ticketId', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticketCheck = await db.selectFrom('tickets')
      .select('subject')
      .where('id', '=', ticketId)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!ticketCheck) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const { subject } = ticketCheck;

    await db.deleteFrom('tickets')
      .where('id', '=', ticketId)
      .where('user_id', '=', req.user.id)
      .execute();

    logAction(req.user.id, req.user.email, 'delete', 'ticket', ticketId, subject);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
