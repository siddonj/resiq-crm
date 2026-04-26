const express = require('express');
const auth = require('../middleware/auth');
const { agentQueue } = require('../workers/agentWorker');

const router = express.Router();

function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

function aiConfigMissingResponse(res) {
  return res.status(503).json({
    error: 'AI is not configured. Set OPENAI_API_KEY on the server to enable this endpoint.'
  });
}

// Trigger a new AI prospecting job
router.post('/prospect', auth, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  if (!isOpenAIConfigured()) {
    return aiConfigMissingResponse(res);
  }

  try {
    // Add job to Bull queue
    await agentQueue.add('prospect', {
      prompt,
      userId: req.user.id,
    });

    res.json({ message: 'Prospecting agent started successfully in the background.' });
  } catch (error) {
    console.error('Error queueing agent task:', error);
    res.status(500).json({ error: 'Failed to start agent task' });
  }
});

// Generate AI Form Suggestions
router.post('/form-suggestions', auth, async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  if (!isOpenAIConfigured()) {
    return aiConfigMissingResponse(res);
  }

  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `I am creating a lead capture form for my CRM. The internal name/goal for the form is: "${title}".
Give me 3 Lead Magnet ideas to offer in exchange for contact info, a punchy Landing Page Headline, Subheadline, and a Call-To-Action (CTA) button text.

Respond strictly in JSON format:
{
  "leadMagnets": ["Idea 1", "Idea 2", "Idea 3"],
  "headline": "...",
  "subheadline": "...",
  "cta": "..."
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert marketing copywriter and conversion optimization specialist.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json(result);
  } catch (error) {
    console.error('Error generating form suggestions:', error);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

// Universal AI context-aware advice
router.post('/advice', auth, async (req, res) => {
  const { tool, contextData, goal } = req.body;
  if (!tool) return res.status(400).json({ error: 'Tool name is required' });

  if (!isOpenAIConfigured()) {
    return aiConfigMissingResponse(res);
  }

  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `You are the built-in AI Copilot for ResiQ CRM. 
The user is currently using the "${tool}" tool.
Their goal or request is: "${goal || 'Give me relevant advice, a template, or a strategy for what I am looking at.'}"
Here is the context data from the page:
${JSON.stringify(contextData, null, 2)}

Provide a concise, highly actionable, and professional response. Under 150 words. If they are making a proposal or invoice, provide a short template or copy. If they are looking at a deal, suggest next steps.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert sales, marketing, and operational AI assistant.' },
        { role: 'user', content: prompt }
      ]
    });

    res.json({ advice: completion.choices[0].message.content });
  } catch (error) {
    console.error('Error generating advice:', error);
    res.status(500).json({ error: 'Failed to generate advice' });
  }
});

module.exports = router;
