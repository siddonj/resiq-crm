const Queue = require('bull');
const { Pool } = require('pg');
const OpenAI = require('openai');
const axios = require('axios');
const cheerio = require('cheerio');
const { logAction } = require('../services/auditLogger');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const enrichmentQueue = new Queue('enrichment-tasks', process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const genericFreeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];

// Hunter.io: verify an email address and return verification status
async function hunterVerifyEmail(email) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey || !email) return null;
  try {
    const res = await axios.get('https://api.hunter.io/v2/email-verifier', {
      params: { email, api_key: apiKey },
      timeout: 10000,
    });
    return res.data?.data || null;
  } catch (err) {
    console.warn('Hunter email verification failed:', err.message);
    return null;
  }
}

// Hunter.io: look up a person by domain + name to find email, job title, LinkedIn
async function hunterFindPerson(domain, firstName, lastName) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey || !domain) return null;
  try {
    const params = { domain, api_key: apiKey };
    if (firstName) params.first_name = firstName;
    if (lastName) params.last_name = lastName;
    const res = await axios.get('https://api.hunter.io/v2/email-finder', {
      params,
      timeout: 10000,
    });
    return res.data?.data || null;
  } catch (err) {
    console.warn('Hunter email finder failed:', err.message);
    return null;
  }
}

// Hunter.io: get company/domain info including social links and company size
async function hunterDomainSearch(domain) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey || !domain) return null;
  try {
    const res = await axios.get('https://api.hunter.io/v2/domain-search', {
      params: { domain, api_key: apiKey, limit: 1 },
      timeout: 10000,
    });
    return res.data?.data || null;
  } catch (err) {
    console.warn('Hunter domain search failed:', err.message);
    return null;
  }
}

async function processEnrichmentJob(job) {
  const { contactId, dealId, userId } = job.data;
  console.log(`Starting Auto-Enrichment for Contact ID: ${contactId}`);

  try {
    const contactRes = await pool.query('SELECT * FROM contacts WHERE id = $1 AND user_id = $2', [contactId, userId]);
    if (contactRes.rows.length === 0) return { error: 'Contact not found' };
    const contact = contactRes.rows[0];

    const dealRes = dealId
      ? await pool.query('SELECT * FROM deals WHERE id = $1 AND user_id = $2', [dealId, userId])
      : { rows: [] };
    const deal = dealRes.rows[0];

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

    // ── Hunter.io enrichment ─────────────────────────────────────────────────
    let hunterPerson = null;
    let hunterDomain = null;
    let emailVerified = contact.email_verified || false;
    let enrichmentSources = [];

    if (targetDomain) {
      // Parse first/last name from contact name for person lookup
      const nameParts = (contact.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || null;
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

      // Run Hunter lookups in parallel
      [hunterPerson, hunterDomain] = await Promise.all([
        hunterFindPerson(targetDomain, firstName, lastName),
        hunterDomainSearch(targetDomain),
      ]);

      if (hunterPerson) enrichmentSources.push('hunter.io');
      if (hunterDomain) enrichmentSources.push('hunter.io-domain');

      // Verify existing email if present
      if (contact.email) {
        const verification = await hunterVerifyEmail(contact.email);
        if (verification) {
          emailVerified = verification.status === 'valid';
        }
      }
    }

    // ── Website scrape for OpenAI context ────────────────────────────────────
    let webContent = '';
    let finalUrlFetched = '';

    if (targetDomain) {
      try {
        const response = await axios.get(`http://${targetDomain}`, {
          timeout: 8000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const $ = cheerio.load(response.data);
        $('script, style').remove();
        webContent = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3500);
        finalUrlFetched = targetDomain;
      } catch (err) {
        console.log(`Failed to fetch http://${targetDomain}, relying on LLM knowledge.`);
      }
    }

    // ── OpenAI company intelligence ───────────────────────────────────────────
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const hunterContext = hunterDomain
      ? `Hunter.io data: organization="${hunterDomain.organization}", industry="${hunterDomain.industry}", company_size="${hunterDomain.company_size}", twitter="${hunterDomain.twitter}", linkedin="${hunterDomain.linkedin}"`
      : '';

    const prompt = `You are a B2B sales development AI (like Clearbit).
Target Entity: ${fallbackSearch}
Domain (if known): ${targetDomain || 'Unknown'}
${hunterContext}
Scraped Website Content: "${webContent}"

Analyze the target and return a strictly formatted JSON object:
{
  "company_description": "(A concise 2-sentence summary of what this company does)",
  "company_size": "(E.g. 1-10, 11-50, 51-200, 201-500, 501+ employees)",
  "industry": "(E.g. Real Estate, PropTech, SaaS, Agency...)",
  "company_website": "(Full URL if known, else null)",
  "linkedin_company_url": "(LinkedIn company page URL if known, else null)",
  "job_title": "(Most likely job title for this person based on their name and company, else null)",
  "competitors": ["Comp A", "Comp B"],
  "recommended_service_line": "(Match to ONE of: managed_wifi, proptech_selection, fractional_it, vendor_rfp, ai_automation, team_process, or null)"
}

Ensure JSON is well-formed. Return null for unknown fields.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    enrichmentSources.push('openai');

    const parsed = JSON.parse(completion.choices[0].message.content);

    // ── Merge Hunter + OpenAI results ─────────────────────────────────────────
    const industry = hunterDomain?.industry || parsed.industry || null;
    const companySize = hunterDomain?.company_size?.toString() || parsed.company_size || null;
    const companyWebsite = parsed.company_website || (targetDomain ? `https://${targetDomain}` : null);
    const linkedinUrl = hunterPerson?.linkedin || hunterDomain?.linkedin || parsed.linkedin_company_url || null;
    const jobTitle = hunterPerson?.position || parsed.job_title || null;

    // Format enrichment note
    const aiNotes = `\n---\n[🤖 AI Enrichment – ${new Date().toISOString()}]\nOverview: ${parsed.company_description}\nIndustry: ${industry}\nSize: ${companySize}\nCompetitors: ${parsed.competitors ? parsed.competitors.join(', ') : 'Unknown'}\nSource: ${finalUrlFetched || 'LLM Training Data'}\n---\n`;

    const currentNotes = contact.notes || '';
    const newNotes = `${aiNotes}\n${currentNotes}`;

    let newCustomFields = contact.custom_fields || {};
    if (typeof newCustomFields === 'string') {
      try { newCustomFields = JSON.parse(newCustomFields); } catch(e) { newCustomFields = {}; }
    }
    newCustomFields.competitors = parsed.competitors ? parsed.competitors.join(', ') : '';

    const aiServiceLine = parsed.recommended_service_line || null;

    // ── Persist enrichment data ───────────────────────────────────────────────
    await pool.query(
      `UPDATE contacts SET
        notes = $1,
        service_line = COALESCE(service_line, $2),
        custom_fields = $3,
        industry = COALESCE($4, industry),
        company_size = COALESCE($5, company_size),
        company_website = COALESCE($6, company_website),
        linkedin_url = COALESCE($7, linkedin_url),
        job_title = COALESCE($8, job_title),
        email_verified = $9,
        enriched_at = NOW(),
        enrichment_source = $10
      WHERE id = $11`,
      [
        newNotes,
        aiServiceLine,
        JSON.stringify(newCustomFields),
        industry,
        companySize,
        companyWebsite,
        linkedinUrl,
        jobTitle,
        emailVerified,
        enrichmentSources.join(', '),
        contact.id,
      ]
    );

    // Update deal service line if blank
    if (deal && aiServiceLine && (!deal.service_line || deal.service_line === '')) {
      await pool.query(`UPDATE deals SET service_line = $1 WHERE id = $2`, [aiServiceLine, deal.id]);
    }

    try {
      logAction(userId, 'AI System (Auto-Enrichment)', 'update', 'contact', contact.id, `Contact enriched for ${contact.company || contact.email}.`);
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
