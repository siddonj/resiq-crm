const Queue = require('bull');
const { Pool } = require('pg');
const OpenAI = require('openai');
const axios = require('axios');
const cheerio = require('cheerio');
const { logAction } = require('../services/auditLogger');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const enrichmentQueue = new Queue('enrichment-tasks', process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const genericFreeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];

async function processEnrichmentJob(job) {
  const { contactId, dealId, userId } = job.data;
  console.log(`Starting Auto-Enrichment for Contact ID: ${contactId}`);

  try {
    const contactRes = await pool.query('SELECT * FROM contacts WHERE id = $1 AND user_id = $2', [contactId, userId]);
    if (contactRes.rows.length === 0) return { error: 'Contact not found' };
    const contact = contactRes.rows[0];

    const dealRes = await pool.query('SELECT * FROM deals WHERE id = $1 AND user_id = $2', [dealId, userId]);
    const deal = dealRes.rows[0]; // Might be undefined if not linked

    // Determine target domain based on email or company
    let targetDomain = null;
    let fallbackSearch = contact.company || contact.name;

    if (contact.email && contact.email.includes('@')) {
      const emailDomain = contact.email.split('@')[1];
      if (!genericFreeDomains.includes(emailDomain.toLowerCase())) {
        targetDomain = emailDomain;
      }
    }

    if (!targetDomain && (!contact.company || contact.company.trim() === '')) {
      return { skipped: 'No business domain found and no company name available for search.' };
    }

    let webContent = '';
    let finalUrlFetched = '';

    // Attempt simple page scrape if domain is known
    if (targetDomain) {
      try {
        const response = await axios.get(`http://${targetDomain}`, {
          timeout: 8000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const $ = cheerio.load(response.data);
        $('script, style').remove();
        webContent = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3500); // Send up to ~700-1000 tokens
        finalUrlFetched = targetDomain;
      } catch (err) {
        console.log(`Failed to fetch simple domain http://${targetDomain}, relying purely on LLM knowledge base.`);
      }
    }

    // Call OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `You are a B2B sales development AI (like Clearbit).
Target Entity: ${fallbackSearch}
Domain (if known): ${targetDomain || 'Unknown'}
Scraped Website Content: "${webContent}"

Analyze the target and return a strictly formatted JSON object containing:
{
  "company_description": "(A concise 2-sentence summary of what this company does)",
  "estimated_size": "(E.g. 1-10, 11-50, 50-200, 200+ employees...)",
  "industry": "(E.g. Real Estate, PropTech, Agency...)",
  "competitors": ["Comp A", "Comp B"],
  "recommended_service_line": "(Match to ONE of: managed_wifi, proptech_selection, fractional_it, vendor_rfp, ai_automation, team_process, or null if absolutely zero fit)"
}

If you rely wholly on your internal knowledge base due to weak scraped content, state that gracefully but confidently. Ensure JSON is well-formed.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    // Format new note appending to existing
    const aiNotes = `
---
[🤖 AI Auto-Enrichment executed on ${new Date().toISOString()}]
Overview: ${parsed.company_description}
Industry: ${parsed.industry}
Estimated Size: ${parsed.estimated_size}
Potential Competitors: ${parsed.competitors ? parsed.competitors.join(', ') : 'Unknown'}
Source: ${finalUrlFetched ? finalUrlFetched : 'LLM Training Data'}
---
`;

    const currentNotes = contact.notes || '';
    const newNotes = `${aiNotes}\n${currentNotes}`;

    let newCustomFields = contact.custom_fields || {};
    if (typeof newCustomFields === 'string') {
      try { newCustomFields = JSON.parse(newCustomFields); } catch(e) { newCustomFields = {}; }
    }
    newCustomFields.industry = parsed.industry;
    newCustomFields.estimated_size = parsed.estimated_size;
    newCustomFields.competitors = parsed.competitors ? parsed.competitors.join(', ') : '';

    let aiServiceLine = parsed.recommended_service_line || null;

    // Update Contact
    await pool.query(
      `UPDATE contacts SET notes = $1, service_line = COALESCE(service_line, $2), custom_fields = $3 WHERE id = $4`,
      [newNotes, aiServiceLine, JSON.stringify(newCustomFields), contact.id]
    );

    // Update Deal Service Line if possible and explicitly set inside AI
    if (deal && aiServiceLine) {
      // Only set if not already set, or if the model gives a high confidence line.
      if (!deal.service_line || deal.service_line === '') {
        await pool.query(
          `UPDATE deals SET service_line = $1 WHERE id = $2`,
          [aiServiceLine, deal.id]
        );
      }
    }

    try {
      logAction(userId, 'AI System (Auto-Enrichment)', 'update', 'contact', contact.id, `Contact enriched via AI pipeline for ${contact.company || contact.email}.`);
    } catch(e) {}

    console.log(`Enrichment complete for ${contact.id}`);
    return { success: true, parsed };

  } catch (error) {
    console.error('Enrichment Worker failed:', error);
    throw error;
  }
}

enrichmentQueue.process(processEnrichmentJob);

module.exports = {
  enrichmentQueue
};
