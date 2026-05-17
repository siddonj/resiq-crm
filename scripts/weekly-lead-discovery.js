#!/usr/bin/env node
/**
 * Weekly Lead Discovery Script
 *
 * Searches Reddit for people looking for CRM solutions in property tech
 * and imports them into the ResiQ CRM outbound_leads table.
 *
 * Designed to be run weekly via cron.
 */

const https = require('https');
const { Pool } = require('pg');

const USER_ID = '8100955d-4bd1-4278-aba9-d73929bf4cfe';
const USER_AGENT = 'ResiQ CRM Lead Finder/1.0 (weekly lead discovery)';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SEARCH_CONFIGS = [
  { subreddit: 'PropertyManagement', keywords: 'CRM+need+OR+recommend+OR+looking+for+OR+software' },
  { subreddit: 'RealEstateTechnology', keywords: 'CRM+need+OR+looking+for+OR+recommend+OR+help' },
  { subreddit: 'smallbusiness', keywords: 'CRM+recommendation+OR+looking+for+CRM+OR+need+a+CRM+OR+customer+management' },
  { subreddit: 'realtors', keywords: 'CRM+recommendation+OR+best+CRM+OR+looking+for+CRM' },
  { subreddit: 'CommercialRealEstate', keywords: 'CRM+software+OR+property+management+software+OR+need+CRM+OR+recommend' },
  { subreddit: 'PropertyTech', keywords: 'CRM+OR+software+OR+platform+OR+management' },
];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Failed to parse JSON from ${url}`));
        }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

function extractName(d) {
  return d.author || 'unknown_redditor';
}

function extractCompany(title, selftext) {
  const text = `${title} ${selftext}`.toLowerCase();
  const companyPatterns = [
    /(?:at|from|with|for)\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\s+[,;.]|\s+(?:is|and|we|i|the|in|on|for|a\s)|$)/,
    /(?:my\s+)(?:company|business|firm|agency|team|startup)\s+(?:is\s+)?(?:\"([^\"]+)\"|called\s+([A-Z][A-Za-z0-9\s&.]+))/,
  ];
  for (const pattern of companyPatterns) {
    const m = text.match(pattern);
    if (m) return (m[1] || m[2] || '').trim().slice(0, 100);
  }
  return null;
}

function computeDedupeKey(postId, title, author) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(`reddit:${postId}`).digest('hex');
}

function scoreLead(title, selftext) {
  const text = `${title} ${selftext}`.toLowerCase();
  let fitScore = 50;
  let intentScore = 30;

  // Proptech/real estate signals
  const fitSignals = [
    'property management', 'real estate', 'commercial real estate',
    'appfolio', 'yardi', 'rentvine', 'property', 'landlord',
    'tenant', 'leasing', 'broker', 'realtor', 'crm for',
  ];
  for (const s of fitSignals) {
    if (text.includes(s)) fitScore += 8;
  }

  // Intent signals
  const intentSignals = [
    'looking for', 'recommend', 'need', 'help', 'suggestion',
    'switching', 'moving from', 'alternatives', 'replace',
    'stuck', 'pain', 'manual', 'spreadsheet', 'struggling',
    'anyone use', 'experience with', 'considering',
  ];
  for (const s of intentSignals) {
    if (text.includes(s)) intentScore += 8;
  }

  // Commercial real estate = higher value
  if (text.includes('commercial real estate') || text.includes('cre ')) fitScore += 10;
  if (text.includes('multi-family') || text.includes('multifamily')) fitScore += 8;
  if (text.includes('scale') || text.includes('growing') || text.includes('hiring')) intentScore += 10;

  fitScore = Math.min(100, Math.max(0, fitScore));
  intentScore = Math.min(100, Math.max(0, intentScore));
  const totalScore = Math.round((fitScore + intentScore) / 2);
  const status = totalScore >= 70 ? 'qualified' : 'new';
  const nextAction = totalScore >= 70
    ? 'Research and prepare personalized outreach'
    : 'Monitor for additional engagement signals';

  return { fitScore, intentScore, totalScore, status, nextAction };
}

async function searchSubreddit(subreddit, keywords) {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${keywords}&restrict_sr=1&sort=new&limit=15`;
  try {
    const data = await fetchJSON(url);
    return (data?.data?.children || []).map(p => p.data).filter(Boolean);
  } catch (err) {
    console.error(`  ⚠️ Error searching r/${subreddit}: ${err.message}`);
    return [];
  }
}

async function importLead(d, dedupeKey, scored) {
  const title = d.title || 'Untitled';
  const author = d.author || 'unknown';
  const selftext = (d.selftext || '').slice(0, 500);
  const subreddit = d.subreddit || 'unknown';
  const permalink = d.permalink || '';
  const url = `https://reddit.com${permalink}`;
  const company = extractCompany(title, selftext);
  const name = extractName(d);
  const created = new Date(d.created_utc * 1000).toISOString().split('T')[0];

  // Check duplicate
  const existing = await pool.query(
    `SELECT id FROM outbound_leads WHERE user_id = $1 AND dedupe_key = $2`,
    [USER_ID, dedupeKey]
  );
  if (existing.rows.length > 0) return { status: 'duplicate', id: existing.rows[0].id, name };

  const notes = `[Reddit r/${subreddit} | ${created}] ${title}\n\n${selftext.slice(0, 300)}`;

  const result = await pool.query(
    `INSERT INTO outbound_leads
      (user_id, source_type, source_reference, source_confidence, is_synthetic,
       name, company, title, notes, website, raw_data, dedupe_key,
       fit_score, intent_score, total_score, status, next_recommended_action)
     VALUES ($1, 'api', $2, 80, FALSE,
             $3, $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      USER_ID,
      `reddit-autodiscover-${subreddit}-${d.id}`,
      author, company, `Reddit User (${subreddit})`,
      notes, url,
      JSON.stringify({ subreddit, post_id: d.id, title, score: d.score, num_comments: d.num_comments, created_utc: d.created_utc }),
      dedupeKey,
      scored.fitScore, scored.intentScore, scored.totalScore, scored.status, scored.nextAction,
    ]
  );

  return { status: 'imported', id: result.rows[0].id, name, score: scored.totalScore };
}

async function main() {
  const startTime = Date.now();
  console.log(`\n🔍 ResiQ Weekly Lead Discovery — ${new Date().toISOString().split('T')[0]}\n`);

  let totalFound = 0;
  let totalImported = 0;
  let totalDuplicates = 0;
  let totalErrors = 0;

  for (const config of SEARCH_CONFIGS) {
    console.log(`  📡 Searching r/${config.subreddit}...`);
    const posts = await searchSubreddit(config.subreddit, config.keywords);
    console.log(`     Found ${posts.length} posts`);

    for (const d of posts) {
      totalFound++;
      const dedupeKey = computeDedupeKey(d.id, d.title, d.author);
      const scored = scoreLead(d.title, d.selftext || '');

      // Skip low-scoring leads
      if (scored.totalScore < 40) continue;

      try {
        const result = await importLead(d, dedupeKey, scored);
        if (result.status === 'imported') {
          totalImported++;
          console.log(`     ✅ ${result.name} → score: ${result.score}`);
        } else if (result.status === 'duplicate') {
          totalDuplicates++;
        }
      } catch (err) {
        totalErrors++;
        console.error(`     ❌ Error importing: ${err.message}`);
      }
    }
  }

  await pool.end();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n📊 Results: ${totalImported} imported, ${totalDuplicates} duplicates, ${totalErrors} errors (${elapsed}s)`);
  console.log(`   ${totalFound} posts scanned across ${SEARCH_CONFIGS.length} subreddits\n`);

  // Return summary as JSON for cron logging
  console.log(JSON.stringify({
    date: new Date().toISOString().split('T')[0],
    subreddits_scanned: SEARCH_CONFIGS.length,
    posts_found: totalFound,
    imported: totalImported,
    duplicates: totalDuplicates,
    errors: totalErrors,
    elapsed_seconds: parseFloat(elapsed),
  }));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
