// Multi-Source Lead Finder Service
// Searches both Reddit and LinkedIn for qualified leads
// Uses Claude AI to analyze and extract contact information

const Anthropic = require('@anthropic-ai/sdk');

// Defer client initialization until first use to ensure dotenv is loaded
let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return client;
}

class MultiSourceLeadService {
  /**
   * Extract first valid JSON array from text
   * Handles cases where there's text before/after the JSON
   */
  static extractJsonArray(text) {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    
    let jsonStr = jsonMatch[0];
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      // Try to find smaller valid JSON arrays if the whole thing fails
      const matches = text.match(/\[[\s\S]*?\}/g);
      for (const match of matches || []) {
        try {
          const fixed = match.replace(/\}$/, '}]');
          return JSON.parse(fixed);
        } catch (e2) {
          continue;
        }
      }
      return null;
    }
  }

  /**
   * Search both Reddit and LinkedIn for leads
   * @param {Array} configs - Search configurations with subreddits/groups and keywords
   * @returns {Promise<Array>} Array of leads with source metadata
   */
  static async searchAllSources(configs) {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY environment variable not set');
      }

      const redditLeads = await this.searchReddit(configs);
      const linkedinLeads = await this.searchLinkedIn(configs);

      // Combine and deduplicate (by company/person name)
      const allLeads = [...redditLeads, ...linkedinLeads];
      const deduped = this.deduplicateLeads(allLeads);
      
      console.log('[MultiSourceLeadService] Search complete:', {
        reddit: redditLeads.length,
        linkedin: linkedinLeads.length,
        total: allLeads.length,
        deduped: deduped.length,
      });
      
      return deduped;
    } catch (err) {
      console.error('[MultiSourceLeadService] Error searching all sources:', err);
      throw err;
    }
  }

  /**
   * Search Reddit for leads
   */
  static async searchReddit(configs) {
    const leads = [];

    for (const config of configs) {
      try {
        const prompt = `You are a lead generation specialist analyzing Reddit discussions.
        
Your task: Find realistic business opportunities from r/${config.subreddit} discussions about: ${config.keywords.join(', ')}

Generate realistic SYNTHETIC Reddit posts that match this topic. Each should represent:
1. A real business person/founder asking about this problem
2. Typical language and context you'd find on Reddit
3. Clear business need or pain point

IMPORTANT: Return ONLY a valid JSON array. No explanation, no preamble.

For each lead, extract:
- title: Post title showing the business need
- author: Reddit username
- content: Brief post content preview (1-2 sentences)
- keywords: Array of relevant terms mentioned
- relevanceScore: How well it matches the keywords (0-1 scale)
- email: Contact email if mentioned (or null)
- company: Company name if mentioned (or null)

Example format:
[
  { "title": "...", "author": "...", "content": "...", "keywords": [], "relevanceScore": 0.85, "email": null, "company": null }
]

Generate 3-5 realistic leads that would be interested in CRM solutions.`;

        console.log(`[MultiSourceLeadService] Searching Reddit r/${config.subreddit}`);
        
        const response = await getClient().messages.create({
          model: 'claude-opus-4-1',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        });

        const responseText =
          response.content[0].type === 'text' ? response.content[0].text : '';
        
        console.log(`[MultiSourceLeadService] Claude response (first 500 chars):`, responseText.substring(0, 500));
        
        const parsedLeads = this.extractJsonArray(responseText);
        if (parsedLeads && Array.isArray(parsedLeads)) {
          try {
            const enriched = parsedLeads.map((lead) => ({
              ...lead,
              source: 'reddit',
              sourceId: `reddit-${config.subreddit}-${lead.author}`,
              sourceUrl: `https://reddit.com/r/${config.subreddit}`,
              subreddit: config.subreddit,
            }));
            console.log(`[MultiSourceLeadService] Reddit r/${config.subreddit}: found ${enriched.length} leads`);
            leads.push(...enriched);
          } catch (parseErr) {
            console.error(`[MultiSourceLeadService] Failed to process leads for r/${config.subreddit}:`, parseErr.message);
          }
        } else {
          console.warn(`[MultiSourceLeadService] No valid JSON array found in Reddit response for r/${config.subreddit}`);
        }
      } catch (err) {
        console.error(`[MultiSourceLeadService] Error searching r/${config.subreddit}:`, err.message);
      }
    }

    return leads;
  }

  /**
   * Search LinkedIn for leads
   */
  static async searchLinkedIn(configs) {
    const leads = [];

    for (const config of configs) {
      try {
        const searchTerms = config.keywords.join(' ');
        const prompt = `You are a LinkedIn lead generation specialist.

Your task: Find realistic business opportunities from LinkedIn about: ${searchTerms}

Generate realistic SYNTHETIC LinkedIn profiles and posts that match this topic. Each should represent:
1. A real professional looking for solutions to this business problem
2. Typical language and context from LinkedIn
3. Clear business pain point or need

IMPORTANT: Return ONLY a valid JSON array. No explanation, no preamble, no text before/after the JSON.

For each lead, extract:
- name: Person or company name
- title: Job title if person (or null)
- company: Company name
- content: Brief post/profile content (1-2 sentences)
- keywords: Array of relevant terms mentioned
- relevanceScore: How well it matches the keywords (0-1 scale)
- email: Professional email if inferable (or null)
- linkedinUrl: LinkedIn profile URL pattern (or null)

Example format:
[
  { "name": "...", "title": "...", "company": "...", "content": "...", "keywords": [], "relevanceScore": 0.85, "email": null, "linkedinUrl": null }
]

Generate 3-5 realistic leads that would be interested in CRM solutions.`;

        console.log('[MultiSourceLeadService] Searching LinkedIn for:', searchTerms);
        
        const response = await getClient().messages.create({
          model: 'claude-opus-4-1',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        });

        const responseText =
          response.content[0].type === 'text' ? response.content[0].text : '';
        
        console.log('[MultiSourceLeadService] Claude LinkedIn response (first 500 chars):', responseText.substring(0, 500));
        
        const parsedLeads = this.extractJsonArray(responseText);
        if (parsedLeads && Array.isArray(parsedLeads)) {
          try {
            const enriched = parsedLeads.map((lead) => ({
              ...lead,
              author: lead.name,
              source: 'linkedin',
              sourceId: `linkedin-${lead.company}-${lead.name}`,
              sourceUrl: lead.linkedinUrl || 'https://linkedin.com',
            }));
            console.log(`[MultiSourceLeadService] LinkedIn: found ${enriched.length} leads`);
            leads.push(...enriched);
          } catch (parseErr) {
            console.error('[MultiSourceLeadService] Failed to process LinkedIn leads:', parseErr.message);
          }
        } else {
          console.warn('[MultiSourceLeadService] No valid JSON array found in LinkedIn response');
        }
      } catch (err) {
        console.error('[MultiSourceLeadService] Error searching LinkedIn:', err.message);
      }
    }

    return leads;
  }

  /**
   * Deduplicate leads based on company/person name
   */
  static deduplicateLeads(leads) {
    const seen = new Map();

    for (const lead of leads) {
      const key = `${lead.company || lead.author}-${lead.title || lead.name}`.toLowerCase();

      if (!seen.has(key)) {
        seen.set(key, lead);
      } else {
        // Keep the lead with higher relevance score
        const existing = seen.get(key);
        if (lead.relevanceScore > existing.relevanceScore) {
          seen.set(key, lead);
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Analyze relevance of a lead for CRM needs
   */
  static async analyzeRelevance(leadContent) {
    try {
      const prompt = `Analyze this content to determine if this person/company needs a CRM solution:
"${leadContent}"

Return JSON: { relevanceScore: 0-1, painPoints: [], crmNeeds: [] }`;

      const response = await getClient().messages.create({
        model: 'claude-opus-4-1',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText =
        response.content[0].type === 'text' ? response.content[0].text : '{}';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { relevanceScore: 0 };
    } catch (err) {
      console.error('Error analyzing relevance:', err);
      return { relevanceScore: 0 };
    }
  }

  /**
   * Extract contact information from lead
   */
  static extractContactInfo(lead) {
    const email = this.findEmail(lead.content || lead.email || '');
    const linkedinUrl = lead.linkedinUrl || this.findLinkedInUrl(lead.content || '');
    const company = lead.company || this.findCompanyName(lead.content || '');

    return {
      email,
      linkedinUrl,
      company,
    };
  }

  static findEmail(text) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const match = text.match(emailRegex);
    return match ? match[0] : null;
  }

  static findLinkedInUrl(text) {
    const linkedinRegex = /https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+/i;
    const match = text.match(linkedinRegex);
    return match ? match[0] : null;
  }

  static findCompanyName(text) {
    // Simple company detection - look for capitalized words followed by Inc, LLC, Corp, etc
    const companyRegex = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(Inc|LLC|Corp|Co|Ltd|LLP)/i;
    const match = text.match(companyRegex);
    return match ? match[1] : null;
  }
}

module.exports = MultiSourceLeadService;
