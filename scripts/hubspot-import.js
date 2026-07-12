#!/usr/bin/env node
/**
 * HubSpot -> ResiQ CRM one-time import (CRM v3 API, private app token).
 *
 * Usage:
 *   HUBSPOT_PRIVATE_APP_TOKEN=pat-... node scripts/hubspot-import.js --dry-run
 *   HUBSPOT_PRIVATE_APP_TOKEN=pat-... node scripts/hubspot-import.js --run
 *   ... --run --only contacts,deals            # subset
 *   ... --run --user=<uuid>                    # target user (defaults to first user)
 *
 * Order: companies (raw stash + id map) -> contacts (flatten primary company)
 * -> deals (stage mapped) -> engagements (notes/tasks/calls/meetings ->
 * activities, emails -> emails table). Idempotent: upserts on hubspot_id
 * (unique partial indexes from migration 069); re-running creates no dupes.
 * Companies are NOT a first-class object in this app — they flatten onto
 * contacts; full company JSON is preserved in hubspot_import_raw.
 */

const fs = require('fs');
const path = require('path');

// Load .env from repo root (no dotenv dependency, same as run-all-migrations.js)
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
})();

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.DB_URL });

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const BASE = 'https://api.hubapi.com';

// --- CLI args ---------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RUN = args.includes('--run');
let only = null;
let userIdArg = null;
for (const arg of args) {
  if (arg.startsWith('--only')) only = (arg.split('=')[1] || args[args.indexOf(arg) + 1] || '').split(',').filter(Boolean);
  if (arg.startsWith('--user=')) userIdArg = arg.split('=')[1];
}
if (!DRY_RUN && !RUN) {
  console.error('Specify --dry-run or --run');
  process.exit(1);
}
if (!TOKEN) {
  console.error('HUBSPOT_PRIVATE_APP_TOKEN env var is required');
  process.exit(1);
}

const wants = (stage) => !only || only.includes(stage);

// Default HubSpot sales-pipeline stages -> deal_stage enum. Unknown -> 'lead'.
const STAGE_MAP = {
  appointmentscheduled: 'lead',
  qualifiedtobuy: 'qualified',
  presentationscheduled: 'proposal',
  decisionmakerboughtin: 'proposal',
  contractsent: 'proposal',
  closedwon: 'closed_won',
  closedlost: 'closed_lost',
};

// Same precedence/format as outboundUtils.computeDedupeKey + migration 068 backfill.
function dedupeKeyFor({ email, linkedin_url, name, company }) {
  if (email) return `email:${String(email).toLowerCase()}`;
  if (linkedin_url) return `linkedin:${linkedin_url}`;
  return `name_company:${String(name || '').toLowerCase()}|${String(company || '').toLowerCase()}`;
}

// --- HubSpot API helpers ----------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hubspotGet(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') || 10) * 1000;
      console.log(`  429 rate limited — waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${res.status} for ${url}: ${await res.text()}`);
    return res.json();
  }
  throw new Error(`HubSpot rate limit retries exhausted for ${url}`);
}

/** Paged fetch of a CRM v3 object collection. */
async function fetchAll(objectType, properties, associations = []) {
  const results = [];
  let after = null;
  do {
    const params = new URLSearchParams({ limit: '100', properties: properties.join(',') });
    if (associations.length) params.set('associations', associations.join(','));
    if (after) params.set('after', after);
    const page = await hubspotGet(`${BASE}/crm/v3/objects/${objectType}?${params}`);
    results.push(...(page.results || []));
    after = page.paging?.next?.after || null;
    process.stdout.write(`\r  fetched ${results.length} ${objectType}...`);
  } while (after);
  console.log('');
  return results;
}

function assocIds(obj, type) {
  return (obj.associations?.[type]?.results || []).map((r) => String(r.id));
}

// --- Import stages ----------------------------------------------------------
const counts = {};
const warnings = [];

async function resolveUser() {
  if (userIdArg) {
    const r = await pool.query(`SELECT id FROM users WHERE id = $1`, [userIdArg]);
    if (!r.rows.length) throw new Error(`User ${userIdArg} not found`);
    return userIdArg;
  }
  const r = await pool.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
  if (!r.rows.length) throw new Error('No users in database');
  return r.rows[0].id;
}

async function resolveOrg(userId) {
  const r = await pool.query(`SELECT organization_id FROM organization_members WHERE user_id = $1`, [userId]);
  if (r.rows.length !== 1) throw new Error(`Expected exactly one org membership for user ${userId}, found ${r.rows.length}`);
  return r.rows[0].organization_id;
}

async function stashRaw(objectType, hubspotId, payload) {
  if (DRY_RUN) return;
  await pool.query(
    `INSERT INTO hubspot_import_raw (object_type, hubspot_id, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (object_type, hubspot_id) DO UPDATE SET payload = EXCLUDED.payload, imported_at = NOW()`,
    [objectType, hubspotId, JSON.stringify(payload)]
  );
}

async function importCompanies() {
  console.log('\n== Companies (raw stash + map) ==');
  const companies = await fetchAll('companies', ['name', 'domain', 'industry', 'numberofemployees', 'website']);
  const map = new Map();
  for (const c of companies) {
    map.set(String(c.id), {
      name: c.properties.name || null,
      domain: c.properties.domain || null,
      industry: c.properties.industry || null,
      size: c.properties.numberofemployees || null,
      website: c.properties.website || null,
    });
    await stashRaw('company', String(c.id), c);
  }
  counts.companies = companies.length;
  return map;
}

async function importContacts(userId, orgId, companyMap) {
  console.log('\n== Contacts ==');
  const contacts = await fetchAll(
    'contacts',
    ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'linkedin_url', 'website', 'lifecyclestage', 'notes_last_updated'],
    ['companies']
  );
  let created = 0, updated = 0, skipped = 0;
  const idMap = new Map(); // hubspot contact id -> app contact uuid

  for (const c of contacts) {
    const p = c.properties;
    const hubspotId = String(c.id);
    const name = [p.firstname, p.lastname].filter(Boolean).join(' ').trim() || p.email || `HubSpot contact ${hubspotId}`;
    const companyId = assocIds(c, 'companies')[0] || null;
    const comp = companyId ? companyMap.get(companyId) : null;
    const company = comp?.name || p.company || null;
    const email = p.email || null;
    const dedupeKey = dedupeKeyFor({ email, linkedin_url: p.linkedin_url, name, company });

    if (DRY_RUN) {
      const existing = await pool.query(
        `SELECT id FROM contacts WHERE hubspot_id = $1 OR (user_id = $2 AND dedupe_key = $3) LIMIT 1`,
        [hubspotId, userId, dedupeKey]
      );
      existing.rows.length ? updated++ : created++;
      continue;
    }

    await stashRaw('contact', hubspotId, c);

    // 1) match on hubspot_id (re-run), 2) fallback on dedupe_key (pre-existing app contact)
    let row = (await pool.query(`SELECT id FROM contacts WHERE hubspot_id = $1`, [hubspotId])).rows[0];
    if (!row) {
      row = (await pool.query(
        `SELECT id FROM contacts WHERE user_id = $1 AND dedupe_key = $2 AND hubspot_id IS NULL LIMIT 1`,
        [userId, dedupeKey]
      )).rows[0];
    }

    if (row) {
      await pool.query(
        `UPDATE contacts SET
           hubspot_id = $2, hubspot_company_id = $3, company_domain = $4,
           name = COALESCE(NULLIF($5, ''), name),
           email = COALESCE($6, email), phone = COALESCE($7, phone),
           company = COALESCE($8, company), job_title = COALESCE($9, job_title),
           linkedin_url = COALESCE($10, linkedin_url),
           company_website = COALESCE($11, company_website),
           industry = COALESCE($12, industry), company_size = COALESCE($13, company_size)
         WHERE id = $1`,
        [row.id, hubspotId, companyId, comp?.domain || null, name, email, p.phone || null,
         company, p.jobtitle || null, p.linkedin_url || null, comp?.website || p.website || null,
         comp?.industry || null, comp?.size || null]
      );
      updated++;
      idMap.set(hubspotId, row.id);
    } else {
      const ins = await pool.query(
        `INSERT INTO contacts
           (organization_id, user_id, name, email, phone, company, type, job_title,
            linkedin_url, company_website, industry, company_size, dedupe_key,
            hubspot_id, hubspot_company_id, company_domain, custom_fields)
         VALUES ($1,$2,$3,$4,$5,$6,'prospect',$7,$8,$9,$10,$11,$12,$13,$14,$15,'{"source":"hubspot_import"}')
         RETURNING id`,
        [orgId, userId, name, email, p.phone || null, company, p.jobtitle || null,
         p.linkedin_url || null, comp?.website || p.website || null, comp?.industry || null,
         comp?.size || null, dedupeKey, hubspotId, companyId, comp?.domain || null]
      );
      created++;
      idMap.set(hubspotId, ins.rows[0].id);
    }
  }
  counts.contacts = { total: contacts.length, created, updated, skipped };
  return idMap;
}

async function importDeals(userId, orgId, contactIdMap) {
  console.log('\n== Deals ==');
  const deals = await fetchAll(
    'deals',
    ['dealname', 'dealstage', 'amount', 'closedate', 'pipeline', 'createdate'],
    ['contacts']
  );
  let created = 0, updated = 0;
  const unknownStages = new Set();

  for (const d of deals) {
    const p = d.properties;
    const hubspotId = String(d.id);
    const rawStage = String(p.dealstage || '').toLowerCase();
    let stage = STAGE_MAP[rawStage];
    if (!stage) {
      unknownStages.add(rawStage || '(empty)');
      stage = 'lead';
    }
    const contactHsId = assocIds(d, 'contacts')[0] || null;
    const contactId = contactHsId ? contactIdMap.get(contactHsId) || null : null;

    if (DRY_RUN) {
      const existing = await pool.query(`SELECT id FROM deals WHERE hubspot_id = $1`, [hubspotId]);
      existing.rows.length ? updated++ : created++;
      continue;
    }

    await stashRaw('deal', hubspotId, d);
    const existing = (await pool.query(`SELECT id FROM deals WHERE hubspot_id = $1`, [hubspotId])).rows[0];
    if (existing) {
      await pool.query(
        `UPDATE deals SET title = $2, stage = $3, value = $4, close_date = $5,
           contact_id = COALESCE($6, contact_id)
         WHERE id = $1`,
        [existing.id, p.dealname || 'Untitled deal', stage, p.amount || null,
         p.closedate ? p.closedate.slice(0, 10) : null, contactId]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO deals (organization_id, user_id, contact_id, title, stage, value, close_date, notes, hubspot_id, custom_fields)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Imported from HubSpot',$8,'{"source":"hubspot_import"}')`,
        [orgId, userId, contactId, p.dealname || 'Untitled deal', stage, p.amount || null,
         p.closedate ? p.closedate.slice(0, 10) : null, hubspotId]
      );
      created++;
    }
  }
  if (unknownStages.size) {
    warnings.push(`Unknown deal stages mapped to 'lead': ${[...unknownStages].join(', ')}. Custom pipelines need entries in STAGE_MAP.`);
  }
  counts.deals = { total: deals.length, created, updated };
}

const ENGAGEMENT_TYPES = [
  { object: 'notes', props: ['hs_note_body', 'hs_timestamp'], type: 'note', body: (p) => p.hs_note_body },
  { object: 'tasks', props: ['hs_task_subject', 'hs_task_body', 'hs_timestamp'], type: 'task', body: (p) => [p.hs_task_subject, p.hs_task_body].filter(Boolean).join(' — ') },
  { object: 'calls', props: ['hs_call_title', 'hs_call_body', 'hs_timestamp'], type: 'call', body: (p) => [p.hs_call_title, p.hs_call_body].filter(Boolean).join(' — ') },
  { object: 'meetings', props: ['hs_meeting_title', 'hs_meeting_body', 'hs_timestamp'], type: 'meeting', body: (p) => [p.hs_meeting_title, p.hs_meeting_body].filter(Boolean).join(' — ') },
];

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function importEngagements(userId, orgId, contactIdMap) {
  console.log('\n== Engagements (notes/tasks/calls/meetings -> activities) ==');
  for (const eng of ENGAGEMENT_TYPES) {
    const items = await fetchAll(eng.object, eng.props, ['contacts']);
    let created = 0, updated = 0;
    for (const item of items) {
      const hubspotId = `${eng.object}:${item.id}`;
      const contactHsId = assocIds(item, 'contacts')[0] || null;
      const contactId = contactHsId ? contactIdMap.get(contactHsId) || null : null;
      const description = stripHtml(eng.body(item.properties)).slice(0, 5000) || `(empty ${eng.type})`;
      const occurredAt = item.properties.hs_timestamp || item.createdAt || new Date().toISOString();

      if (DRY_RUN) {
        const existing = await pool.query(`SELECT id FROM activities WHERE hubspot_id = $1`, [hubspotId]);
        existing.rows.length ? updated++ : created++;
        continue;
      }
      await stashRaw(eng.object, String(item.id), item);
      const res = await pool.query(
        `INSERT INTO activities (organization_id, user_id, contact_id, type, description, occurred_at, hubspot_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (hubspot_id) WHERE hubspot_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [orgId, userId, contactId, eng.type, description, occurredAt, hubspotId]
      ).catch(async (err) => {
        // Partial unique index conflict targets vary by PG version; fall back to a check.
        if (err.code === '42P10') {
          const existing = await pool.query(`SELECT id FROM activities WHERE hubspot_id = $1`, [hubspotId]);
          if (existing.rows.length) return { rows: [] };
          return pool.query(
            `INSERT INTO activities (organization_id, user_id, contact_id, type, description, occurred_at, hubspot_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [orgId, userId, contactId, eng.type, description, occurredAt, hubspotId]
          );
        }
        throw err;
      });
      res.rows.length ? created++ : updated++;
    }
    counts[eng.object] = { total: items.length, created, existing: updated };
  }

  console.log('\n== Emails ==');
  const emails = await fetchAll(
    'emails',
    ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_email_from_email', 'hs_email_to_email', 'hs_timestamp'],
    ['contacts']
  );
  let created = 0, existing = 0;
  for (const e of emails) {
    const p = e.properties;
    const hubspotId = String(e.id);
    const contactHsId = assocIds(e, 'contacts')[0] || null;
    const contactId = contactHsId ? contactIdMap.get(contactHsId) || null : null;
    const isOutbound = String(p.hs_email_direction || '').toUpperCase() !== 'INCOMING_EMAIL';

    if (DRY_RUN) {
      const ex = await pool.query(`SELECT id FROM emails WHERE hubspot_id = $1`, [hubspotId]);
      ex.rows.length ? existing++ : created++;
      continue;
    }
    const ex = await pool.query(`SELECT id FROM emails WHERE hubspot_id = $1`, [hubspotId]);
    if (ex.rows.length) { existing++; continue; }
    await pool.query(
      `INSERT INTO emails (user_id, contact_id, sender_email, recipient_email, subject, body, is_outbound, received_at, hubspot_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, contactId, p.hs_email_from_email || 'unknown@hubspot-import', p.hs_email_to_email || 'unknown@hubspot-import',
       p.hs_email_subject || null, stripHtml(p.hs_email_text).slice(0, 10000) || null, isOutbound,
       p.hs_timestamp || e.createdAt || null, hubspotId]
    );
    created++;
  }
  counts.emails = { total: emails.length, created, existing };
}

// --- Main -------------------------------------------------------------------
(async () => {
  const started = Date.now();
  console.log(`HubSpot import — mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'RUN'}${only ? `, only: ${only.join(',')}` : ''}`);
  try {
    const userId = await resolveUser();
    const orgId = await resolveOrg(userId);
    console.log(`Target user: ${userId}, org: ${orgId}`);

    const companyMap = wants('contacts') || wants('companies') ? await importCompanies() : new Map();

    let contactIdMap = new Map();
    if (wants('contacts')) {
      contactIdMap = await importContacts(userId, orgId, companyMap);
    } else if (wants('deals') || wants('engagements')) {
      // Rebuild the map from previously-imported contacts.
      const r = await pool.query(`SELECT id, hubspot_id FROM contacts WHERE hubspot_id IS NOT NULL`);
      contactIdMap = new Map(r.rows.map((row) => [row.hubspot_id, row.id]));
    }

    if (wants('deals')) await importDeals(userId, orgId, contactIdMap);
    if (wants('engagements')) await importEngagements(userId, orgId, contactIdMap);

    if (!DRY_RUN) {
      await pool.query(
        `INSERT INTO hubspot_import_runs (user_id, mode, counts, errors, finished_at)
         VALUES ($1, 'run', $2, $3, NOW())`,
        [userId, JSON.stringify(counts), JSON.stringify(warnings)]
      );
    }

    console.log('\n===== Summary =====');
    console.log(JSON.stringify(counts, null, 2));
    for (const w of warnings) console.log(`WARNING: ${w}`);
    console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s${DRY_RUN ? ' (dry run — nothing written)' : ''}`);
  } catch (err) {
    console.error('\nImport failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
