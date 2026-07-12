const integrationSettings = require('./integrationSettings');

async function getOpenAiClient() {
  const apiKey = await integrationSettings.getSetting('openai_api_key');
  if (!apiKey) return null;
  const OpenAI = require('openai');
  return new OpenAI({ apiKey });
}

async function isOpenAiConfigured() {
  return (await getOpenAiClient()) !== null;
}

module.exports = { getOpenAiClient, isOpenAiConfigured };
