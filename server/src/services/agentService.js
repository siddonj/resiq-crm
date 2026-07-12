const { getOpenAiClient } = require('./openaiClient');

async function generateProspects(prompt) {
  try {
    const openai = await getOpenAiClient();
    if (!openai) {
      throw new Error('OPENAI_API_KEY is not set. AI prospecting is unavailable.');
    }

    // Step 1: Search the web for real companies matching the criteria
    const searchResponse = await openai.responses.create({
      model: 'gpt-4o-mini',
      tools: [{ type: 'web_search_preview' }],
      input: `Search the web to find real companies matching this prospect description: ${prompt}. For each company found, include: company name, website, location, what they do, and any available decision-maker names, emails, or phone numbers. Find at least 5 real companies with verified information.`,
    });

    const searchResults = searchResponse.output_text;

    // Step 2: Extract structured JSON from the real search results — no fabrication
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a data extraction assistant. Given real company information from web search results, extract and structure the data as prospect records.

IMPORTANT: Only include companies that were actually found in the search results. Do NOT invent or add companies.

For contact names/emails: use what was found in search results. If a specific person was not found, use a job title (e.g. "Director of IT") and set email to "verify@[companydomain]" to flag it needs manual verification.

You MUST respond with a JSON object containing an array called "prospects". Each object must have:
- "name" (string, real person name if found, otherwise a job title)
- "email" (string, real email if found, otherwise "verify@[domain]")
- "phone" (string, real phone if found, otherwise "")
- "company" (string, the real company name from search results)
- "service_line" (string, one of: 'managed_wifi', 'proptech_selection', 'fractional_it', 'vendor_rfp', 'ai_automation', 'team_process', or a relevant custom value)
- "notes" (string, why this company fits based on what the search results actually say about them)

Respond with strictly valid JSON only.`
        },
        {
          role: 'user',
          content: `Web search results:\n\n${searchResults}\n\nExtract these into structured prospect records.`
        }
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return result.prospects || [];
  } catch (error) {
    console.error('OpenAI Error:', error);
    throw error;
  }
}

module.exports = {
  generateProspects
};
