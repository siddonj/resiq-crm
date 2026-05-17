#!/usr/bin/env node
/**
 * Lead Discovery - stdin/stdout pipeline
 * Reads post data from stdin (JSON lines from curl), outputs lead JSON for import.
 *
 * Usage:
 *   curl -s -A "ResiQ/1.0" "https://www.reddit.com/...search.json" | node discover.js
 */

let rawData = '';
process.stdin.on('data', chunk => rawData += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(rawData);
    const posts = data?.data?.children?.map(c => c.data).filter(Boolean) || [];

    const leads = posts.map(d => {
      const title = d.title || '';
      const selftext = (d.selftext || '').slice(0, 500);
      const text = `${title} ${selftext}`.toLowerCase();
      const subreddit = d.subreddit || 'unknown';
      const created = new Date(d.created_utc * 1000).toISOString().split('T')[0];

      // Score
      let fitScore = 40;
      let intentScore = 20;

      const fitSignals = ['property management','real estate','commercial real estate','appfolio','yardi','rentvine','property','landlord','tenant','leasing','broker','realtor','crm for','property tech','proptech','multi-family','multifamily'];
      for (const s of fitSignals) { if (text.includes(s)) fitScore += 8; }

      const intentSignals = ['looking for','recommend','need','help','suggestion','switching','moving from','alternatives','replace','stuck','pain','manual','spreadsheet','struggling','anyone use','experience with','considering','does anyone','recommendation','best'];
      for (const s of intentSignals) { if (text.includes(s)) intentScore += 8; }

      if (text.includes('commercial real estate') || text.includes('cre ')) fitScore += 10;
      if (text.includes('scale') || text.includes('growing') || text.includes('hiring')) intentScore += 10;

      fitScore = Math.min(100, Math.max(0, fitScore));
      intentScore = Math.min(100, Math.max(0, intentScore));
      const totalScore = Math.round((fitScore + intentScore) / 2);

      // Extract company
      let company = null;
      const companyPatterns = [
        /(?:at|from|with|for)\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\s+[,;.]|\s+(?:is|and|we|i|the|in|on|for|a\s)|$)/,
        /(?:my\s+)(?:company|business|firm|agency|team)\s+(?:is\s+)?(?:"([^"]+)"|called\s+([A-Z][A-Za-z0-9\s&.]+))/,
      ];
      for (const p of companyPatterns) {
        const m = text.match(p);
        if (m) { company = (m[1] || m[2] || '').trim().slice(0, 100); break; }
      }

      const notes = `[Reddit r/${subreddit} | ${created}] ${title}`;

      return {
        name: d.author || 'unknown_redditor',
        company,
        title: `Reddit User (${subreddit})`,
        notes,
        website: `https://reddit.com${d.permalink || ''}`,
        source_type: 'api',
        source_reference: `reddit-autodiscover-${subreddit}-${d.id}`,
        source_confidence: 80,
        fit_score: fitScore,
        intent_score: intentScore,
        total_score: totalScore,
      };
    }).filter(l => l.total_score >= 40 && l.name !== 'AutoModerator');

    console.log(JSON.stringify(leads, null, 2));
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(1);
  }
});
