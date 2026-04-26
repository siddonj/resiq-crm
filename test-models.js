#!/usr/bin/env node
require('dotenv').config({ path: './server/.env' });

const Anthropic = require('./server/node_modules/@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Test different model names
const modelsToTest = [
  'claude-3-5-sonnet-latest',
  'claude-3-5-sonnet-20241022',
  'claude-opus-4-1',
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-sonnet-3-5',
  'gpt-4-turbo',
  'gpt-4',
];

async function testModels() {
  console.log('Testing available models...\n');
  
  for (const model of modelsToTest) {
    try {
      console.log(`Testing ${model}...`);
      const response = await client.messages.create({
        model,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Say "OK"' }],
      });
      console.log(`✅ ${model} works!`);
      console.log(`Response: ${response.content[0].text}\n`);
      break; // Stop after first successful model
    } catch (err) {
      console.log(`❌ ${model} failed: ${err.message}\n`);
    }
  }
}

testModels();
