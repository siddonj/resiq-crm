#!/usr/bin/env node
/**
 * Lead Import Script
 *
 * Imports lead data directly into the outbound_leads table.
 * Reads JSON from stdin or a file argument.
 *
 * Usage:
 *   cat leads.json | node scripts/import-leads.js                # read from stdin
 *   node scripts/import-leads.js leads.json                      # read from file
 *   node scripts/import-leads.js --user=<user-id> leads.json     # specify user
 *
 * JSON format (array or newline-delimited objects):
 *   {"name":"John Doe","email":"john@example.com","company":"Acme","title":"CEO",...}
 *
 * Required fields: name (or first_name + last_name)
 * Optional fields: email, phone, company, title, linkedin_url, website, location, notes
 */

const fs = require('fs');
const crypto = require('crypto');

// Default user (josh@resiq.co - the main admin)
const DEFAULT_USER_ID = '8100955d-4bd1-4278-aba9-d73929bf4cfe';

// Parse args
const args = process.argv.slice(2);
let userId = DEFAULT_USER_ID;
let filePath = null;

for (const arg of args) {
  if (arg.startsWith('--user=')) {
    userId = arg.split('=')[1];
  } else if (!arg.startsWith('--')) {
    filePath = arg;
  }
}

// Get DB connection
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DB_URL,
});

/**
 * Compute a dedupe key from lead data
 */
function computeDedupeKey(lead) {
  const email = (lead.email || '').toLowerCase().trim();
  const phone = (lead.phone || '').replace(/[^0-9]/g, '').slice(-10);
  const linkedin = (lead.linkedin_url || '').toLowerCase().trim().replace(/\/+$/, '');
  const name = (lead.name || lead.first_name || '').toLowerCase().trim();

  if (email) return crypto.createHash('sha256').update(`email:${email}`).digest('hex');
  if (phone) return crypto.createHash('sha256').update(`phone:${phone}`).digest('hex');
  if (linkedin) return crypto.createHash('sha256').update(`linkedin:${linkedin}`).digest('hex');
  if (name) return crypto.createHash('sha256').update(`name:${name}`).digest('hex');
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Score a lead (simplified version)
 */
function scoreLead(lead) {
  let fitScore = 50;
  let intentScore = 30;

  // Has company → better fit
  if (lead.company) fitScore += 15;
  // Has title → better fit
  if (lead.title) fitScore += 10;
  // Has website → more established
  if (lead.website) fitScore += 10;
  // Has linkedin → professional
  if (lead.linkedin_url) fitScore += 10;
  // Has both email and phone → strong contact info
  if (lead.email && lead.phone) fitScore += 5;

  // Intent signals from notes
  const notes = (lead.notes || '').toLowerCase();
  const intentSignals = [
    'looking for', 'need', 'searching', 'interested', 'hiring',
    'growing', 'scaling', 'expand', 'new crm', 'switch',
    'evaluate', 'considering', 'recommend', 'recommendation',
  ];
  for (const signal of intentSignals) {
    if (notes.includes(signal)) intentScore += 10;
  }

  fitScore = Math.min(100, Math.max(0, fitScore));
  intentScore = Math.min(100, Math.max(0, intentScore));
  const totalScore = Math.round((fitScore + intentScore) / 2);

  let status = 'new';
  let nextAction = 'Research company and prepare outreach';

  if (totalScore >= 70) {
    status = 'qualified';
    nextAction = 'Send personalized introduction email';
  } else if (totalScore >= 50) {
    status = 'new';
    nextAction = 'Research company and prepare outreach';
  } else {
    nextAction = 'Monitor for engagement signals';
  }

  return { fitScore, intentScore, totalScore, status, nextAction };
}

/**
 * Import a single lead
 */
async function importLead(lead) {
  const name = lead.name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
  if (!name || name === '') {
    return { success: false, error: 'Missing name', lead };
  }

  const dedupeKey = computeDedupeKey(lead);
  const scored = scoreLead(lead);

  // Check for duplicate
  const existing = await pool.query(
    `SELECT id FROM outbound_leads WHERE user_id = $1 AND dedupe_key = $2`,
    [userId, dedupeKey]
  );

  if (existing.rows.length > 0) {
    return { success: false, error: 'Duplicate', id: existing.rows[0].id, lead };
  }

  const result = await pool.query(
    `INSERT INTO outbound_leads
      (user_id, source_type, source_reference, source_confidence, is_synthetic,
       name, first_name, last_name, email, phone, company, title, linkedin_url,
       website, location, notes, raw_data, dedupe_key,
       fit_score, intent_score, total_score, status, next_recommended_action)
     VALUES ($1, $2, $3, $4, FALSE,
             $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22)
     RETURNING id`,
    [
      userId, lead.source_type || 'api', lead.source_reference || 'web-search', lead.source_confidence || 70,
      name, lead.first_name || null, lead.last_name || null, lead.email || null, lead.phone || null,
      lead.company || null, lead.title || null, lead.linkedin_url || null,
      lead.website || null, lead.location || null, lead.notes || null,
      JSON.stringify(lead), dedupeKey,
      scored.fitScore, scored.intentScore, scored.totalScore, scored.status,
      scored.nextAction,
    ]
  );

  return { success: true, id: result.rows[0].id, score: scored.totalScore, lead };
}

/**
 * Main
 */
async function main() {
  let rawData;

  if (filePath) {
    rawData = fs.readFileSync(filePath, 'utf8');
  } else {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    rawData = Buffer.concat(chunks).toString('utf8');
  }

  let leads;
  try {
    leads = JSON.parse(rawData);
  } catch {
    // Try newline-delimited JSON
    leads = rawData.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean);
  }

  if (!Array.isArray(leads)) leads = [leads];
  if (leads.length === 0) {
    console.log(JSON.stringify({ imported: 0, duplicates: 0, errors: 0, message: 'No leads to import' }));
    return;
  }

  console.log(`\n📥 Importing ${leads.length} leads...\n`);

  let imported = 0, duplicates = 0, errors = 0;
  const results = [];

  for (const lead of leads) {
    const result = await importLead(lead);
    results.push(result);
    if (result.success) {
      imported++;
      console.log(`  ✅ ${result.lead.name || 'Unknown'} → score: ${result.score} — ID: ${result.id}`);
    } else if (result.error === 'Duplicate') {
      duplicates++;
      console.log(`  ⏭️  ${result.lead.name || 'Unknown'} → duplicate (existing ID: ${result.id})`);
    } else {
      errors++;
      console.log(`  ❌ ${result.lead.name || 'Unknown'} → error: ${result.error}`);
    }
  }

  await pool.end();

  console.log(`\n📊 Results: ${imported} imported, ${duplicates} duplicates, ${errors} errors\n`);

  // Output JSON summary for piping
  console.log(JSON.stringify({
    total: leads.length,
    imported,
    duplicates,
    errors,
    results,
  }));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
