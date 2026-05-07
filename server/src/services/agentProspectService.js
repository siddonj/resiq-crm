const pool = require('../models/db');
const { logAction } = require('./auditLogger');

function normalizeProspect(prospect = {}, index = 0) {
  const company = typeof prospect.company === 'string' ? prospect.company.trim() : '';
  const email = typeof prospect.email === 'string' ? prospect.email.trim() : '';

  return {
    name: typeof prospect.name === 'string' && prospect.name.trim()
      ? prospect.name.trim()
      : company || `AI Prospect ${index + 1}`,
    email,
    phone: typeof prospect.phone === 'string' ? prospect.phone.trim() : '',
    company,
    service_line: typeof prospect.service_line === 'string' && prospect.service_line.trim()
      ? prospect.service_line.trim()
      : null,
    notes: typeof prospect.notes === 'string' ? prospect.notes.trim() : '',
  };
}

async function importProspects({ userId, userEmail = 'Agent', prompt = '', prospects = [] }) {
  const createdContacts = [];

  for (const prospect of prospects.map((item, index) => normalizeProspect(item, index))) {
    const notesContext = prospect.notes || prompt;
    const contactResult = await pool.query(
      `INSERT INTO contacts (user_id, name, email, phone, company, type, service_line, notes) 
       VALUES ($1, $2, $3, $4, $5, 'prospect', $6, $7) RETURNING *`,
      [
        userId,
        prospect.name,
        prospect.email,
        prospect.phone,
        prospect.company || 'Unknown Company',
        prospect.service_line,
        notesContext ? `AI Sourced Prospect. Context: ${notesContext}` : 'AI Sourced Prospect.',
      ]
    );

    const newContact = contactResult.rows[0];

    await pool.query(
      `INSERT INTO deals (user_id, contact_id, title, stage, service_line, notes) 
       VALUES ($1, $2, $3, 'lead', $4, $5)`,
      [
        userId,
        newContact.id,
        `AI Prospect: ${newContact.company}`,
        prospect.service_line,
        'Auto-generated via AI Agent Prospecting',
      ]
    );

    logAction(userId, userEmail, 'create', 'contact', newContact.id, newContact.name);
    createdContacts.push(newContact);
  }

  return createdContacts;
}

module.exports = {
  normalizeProspect,
  importProspects,
};
