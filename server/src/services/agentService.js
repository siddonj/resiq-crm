const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateProspects(prompt) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert SDR (Sales Development Representative) agent. 
Based on the user's prompt, research and generate a list of relevant prospects. 
Since you don't have live internet access in this basic version, use your deep knowledge base to suggest REAL companies that fit the criteria, and generate realistic point-of-contact personas for them.

You MUST respond with a JSON object containing an array called "prospects". 
Each object in the array must have:
- "name" (string, the person to contact)
- "email" (string)
- "phone" (string)
- "company" (string, the name of the company)
- "service_line" (string, MUST be one of: 'managed_wifi', 'proptech_selection', 'fractional_it', 'vendor_rfp', 'ai_automation', 'team_process')
- "notes" (string, a short brief on why this company is a good fit and what they do)

Ensure the output is strictly valid JSON.`
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
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
