// Reddit MCP Service
// Uses Claude via MCP to search Reddit for leads matching business keywords

const https = require('https');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Predefined search configurations
const DEFAULT_CONFIGS = [
  {
    subreddit: 'startups',
    keywords: ['need crm', 'crm solution', 'looking for crm', 'crm recommendation'],
  },
  {
    subreddit: 'smallbusiness',
    keywords: ['need crm', 'business management', 'sales tracking', 'customer management'],
  },
  {
    subreddit: 'SaaS',
    keywords: ['crm', 'sales automation', 'customer engagement', 'lead management'],
  },
  {
    subreddit: 'entrepreneur',
    keywords: ['growing business', 'scaling', 'management tool', 'process automation'],
  },
  {
    subreddit: 'webdev',
    keywords: ['client management', 'project tracking', 'customer portal'],
  },
  {
    subreddit: 'freelance',
    keywords: ['client portal', 'invoice', 'project management', 'time tracking'],
  },
  {
    subreddit: 'business',
    keywords: ['crm', 'sales process', 'customer retention', 'business automation'],
  },
  {
    subreddit: 'consulting',
    keywords: ['client management', 'proposal management', 'workflow automation'],
  },
];

class RedditMCPService {
  /**
   * Search Reddit for leads using Claude MCP
   * Returns analysis of posts mentioning relevant keywords
   */
  static async searchRedditForLeads(subreddit, keywords, options = {}) {
    const {
      timeframe = 'week',
      minRelevance = 0.5,
      limit = 50,
    } = options;

    try {
      // Use Claude to search Reddit and extract leads
      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        tools: [
          {
            name: 'search_reddit',
            description: 'Search Reddit for posts in a specific subreddit with keywords',
            input_schema: {
              type: 'object',
              properties: {
                subreddit: {
                  type: 'string',
                  description: 'The subreddit to search (without r/)',
                },
                keywords: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Keywords to search for',
                },
                timeframe: {
                  type: 'string',
                  enum: ['day', 'week', 'month', 'year'],
                  description: 'Time period to search',
                },
                limit: {
                  type: 'integer',
                  description: 'Max number of results',
                },
              },
              required: ['subreddit', 'keywords'],
            },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Search Reddit subreddit r/${subreddit} for discussions about: ${keywords.join(
              ', '
            )}. 
            
            Extract potential leads:
            - Author name
            - Post title
            - Key pain points mentioned
            - Business context clues
            - Contact hints (email, LinkedIn, etc.)
            
            Return a JSON array of leads with: { author, post_title, post_url, subreddit, keywords_matched, relevance_score (0-1), pain_points, business_signals }`,
          },
        ],
      });

      // Parse Claude's response
      return this._parseLeadsResponse(response, subreddit);
    } catch (error) {
      console.error(`Error searching Reddit for leads: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all configured search profiles
   */
  static getDefaultConfigs() {
    return DEFAULT_CONFIGS;
  }

  /**
   * Analyze post content for relevance and lead signals
   */
  static async analyzePostRelevance(postContent, keywords) {
    try {
      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `Analyze this Reddit post for CRM/business software lead potential:

Post: "${postContent}"

Keywords matched: ${keywords.join(', ')}

Return JSON: { 
  relevance_score (0-1), 
  pain_points (array), 
  business_signals (array),
  lead_quality ('high'|'medium'|'low'),
  suggested_next_action (string)
}`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { relevance_score: 0 };
    } catch (error) {
      console.error(`Error analyzing post: ${error.message}`);
      return { relevance_score: 0 };
    }
  }

  /**
   * Extract email or contact info from post and comments
   */
  static async extractContactInfo(author, postContent) {
    try {
      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: `Extract contact information from this Reddit post/comments:

Author: ${author}
Content: "${postContent}"

Return JSON: {
  email (or null),
  website (or null),
  linkedin_hint (or null),
  twitter_hint (or null),
  company_name (or null)
}`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (error) {
      console.error(`Error extracting contact info: ${error.message}`);
      return {};
    }
  }

  /**
   * Parse Claude's response for leads
   */
  static _parseLeadsResponse(response, subreddit) {
    let leadsData = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        const jsonMatch = block.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            leadsData = JSON.parse(jsonMatch[0]);
          } catch (e) {
            console.error('Failed to parse leads JSON:', e);
          }
        }
      }
    }

    return leadsData.map((lead) => ({
      ...lead,
      subreddit,
      discovered_at: new Date().toISOString(),
    }));
  }

  /**
   * Batch search multiple subreddits for leads
   */
  static async searchMultipleSubreddits(configs) {
    const allLeads = [];

    for (const config of configs) {
      try {
        console.log(
          `Searching r/${config.subreddit} for keywords: ${config.keywords.join(', ')}`
        );
        const leads = await this.searchRedditForLeads(
          config.subreddit,
          config.keywords,
          { limit: 50 }
        );
        allLeads.push(...leads);
      } catch (error) {
        console.error(`Failed to search r/${config.subreddit}:`, error.message);
      }
    }

    return allLeads;
  }
}

module.exports = RedditMCPService;
