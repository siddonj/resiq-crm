const Queue = require('bull');
const pool = require('../models/db');
const { generateProspects } = require('../services/agentService');
const { logAction } = require('../services/auditLogger');

// Create a queue for agent-related background tasks
const agentQueue = new Queue('agent-tasks', process.env.REDIS_URL || 'redis://127.0.0.1:6379');

function initAgentWorker() {
  console.log('Agent Worker initialized');

  agentQueue.process('prospect', async (job) => {
    const { prompt, userId } = job.data;
    console.log(`Processing prospect job for user ${userId} with prompt: ${prompt}`);

    try {
      // 1. Call the AI service to generate leads
      const prospects = await generateProspects(prompt);

      if (!Array.isArray(prospects) || prospects.length === 0) {
        console.log('No prospects generated.');
        return;
      }

      // 2. Iterate and save to DB
      for (const p of prospects) {
        // Insert Contact
        const contactResult = await pool.query(
          `INSERT INTO contacts (user_id, name, email, phone, company, type, service_line, notes) 
           VALUES ($1, $2, $3, $4, $5, 'prospect', $6, $7) RETURNING *`,
          [
            userId,
            p.name || 'Unknown Contact',
            p.email || '',
            p.phone || '',
            p.company || 'Unknown Company',
            p.service_line || null,
            `AI Sourced Prospect. Context: ${p.notes || prompt}`
          ]
        );
        const newContact = contactResult.rows[0];

        // Insert Deal representation
        await pool.query(
          `INSERT INTO deals (user_id, contact_id, title, stage, service_line, notes) 
           VALUES ($1, $2, $3, 'lead', $4, $5)`,
          [
            userId,
            newContact.id,
            `AI Prospect: ${newContact.company}`,
            p.service_line || null,
            'Auto-generated via AI Agent Prospecting'
          ]
        );

        // Optional: log to audit logs
        logAction(userId, 'Agent', 'create', 'contact', newContact.id, newContact.name);
      }
      
      console.log(`Successfully imported ${prospects.length} AI prospects.`);
    } catch (error) {
      console.error('Failed to process agent prospect job:', error);
      throw error;
    }
  });
}

module.exports = {
  agentQueue,
  initAgentWorker
};
