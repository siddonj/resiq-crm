const express = require('express');
const router = express.Router();
const { db, sql, pool } = require('../db');
const requireAuth = require('../middleware/auth');

// Apply auth middleware to all routes
router.use(requireAuth);

// Get all sequences for the current user
router.get('/', async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT s.*, 
        COUNT(DISTINCT st.id) as step_count,
        COUNT(DISTINCT e.id) as active_enrollments
      FROM sequences s
      LEFT JOIN sequence_steps st ON s.id = st.sequence_id
      LEFT JOIN sequence_enrollments e ON s.id = e.sequence_id AND e.status = 'active'
      WHERE s.user_id = ${req.user.id}
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `.execute(db);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching sequences:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new sequence
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  try {
    const result = await db.insertInto('sequences')
      .values({
        user_id: req.user.id,
        name,
        description,
      })
      .returningAll()
      .executeTakeFirst();
    res.status(201).json(result);
  } catch (err) {
    console.error('Error creating sequence:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get a specific sequence with its steps
router.get('/:id', async (req, res) => {
  try {
    const sequence = await db.selectFrom('sequences')
      .selectAll()
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!sequence) {
      return res.status(404).json({ error: 'Sequence not found' });
    }

    const steps = await db.selectFrom('sequence_steps')
      .selectAll()
      .where('sequence_id', '=', req.params.id)
      .orderBy('step_number', 'asc')
      .execute();

    // Also get active enrollments
    const enrollments = await db.selectFrom('sequence_enrollments as e')
      .innerJoin('contacts as c', 'c.id', 'e.contact_id')
      .select([
        'e.id',
        'e.sequence_id',
        'e.contact_id',
        'e.user_id',
        'e.status',
        'e.current_step',
        'e.next_step_due_at',
        'e.created_at',
        'e.updated_at',
        'c.first_name',
        'c.last_name',
        'c.email',
      ])
      .where('e.sequence_id', '=', req.params.id)
      .where('e.status', '=', 'active')
      .orderBy('e.created_at', 'desc')
      .execute();

    res.json({
      ...sequence,
      steps,
      enrollments,
    });
  } catch (err) {
    console.error('Error fetching sequence:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update sequence steps (replaces all existing steps)
router.put('/:id/steps', async (req, res) => {
  const { steps } = req.body; // Array of step objects
  const sequenceId = req.params.id;

  try {
    // Verify ownership
    const seqCheck = await db.selectFrom('sequences')
      .select('id')
      .where('id', '=', sequenceId)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!seqCheck) {
      return res.status(404).json({ error: 'Sequence not found' });
    }

    await db.transaction().execute(async (trx) => {
      // Delete existing steps
      await trx.deleteFrom('sequence_steps')
        .where('sequence_id', '=', sequenceId)
        .execute();

      // Insert new steps
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await trx.insertInto('sequence_steps')
          .values({
            sequence_id: sequenceId,
            step_number: i + 1,
            delay_days: step.delay_days || 0,
            type: step.type,
            subject: step.subject || null,
            body: step.body,
          })
          .execute();
      }

      // Update sequence modified timestamp
      await trx.updateTable('sequences')
        .set({ updated_at: new Date() })
        .where('id', '=', sequenceId)
        .execute();
    });

    // Fetch and return the updated steps
    const stepsRes = await db.selectFrom('sequence_steps')
      .selectAll()
      .where('sequence_id', '=', sequenceId)
      .orderBy('step_number', 'asc')
      .execute();
    res.json(stepsRes);
  } catch (err) {
    console.error('Error updating sequence steps:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Enroll a contact in a sequence
router.post('/:id/enroll', async (req, res) => {
  const sequenceId = req.params.id;
  const { contactId } = req.body;

  try {
    // Verify sequence ownership
    const seqCheck = await db.selectFrom('sequences')
      .select('id')
      .where('id', '=', sequenceId)
      .where('user_id', '=', req.user.id)
      .executeTakeFirst();

    if (!seqCheck) {
      return res.status(404).json({ error: 'Sequence not found' });
    }

    // Upsert enrollment (if exists, set active and reset to step 1)
    const result = await db.insertInto('sequence_enrollments')
      .values({
        sequence_id: sequenceId,
        contact_id: contactId,
        user_id: req.user.id,
        status: 'active',
        current_step: 1,
        next_step_due_at: new Date(),
      })
      .onConflict(c => c
        .columns(['sequence_id', 'contact_id'])
        .doUpdateSet({
          status: 'active',
          current_step: 1,
          next_step_due_at: new Date(),
          updated_at: new Date(),
        })
      )
      .returningAll()
      .executeTakeFirst();

    res.status(201).json(result);
  } catch (err) {
    console.error('Error enrolling contact:', err);
    res.status(500).json({ error: 'Server error check unique constraint or references' });
  }
});

module.exports = router;
