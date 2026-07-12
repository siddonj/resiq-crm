const integrationSettings = require('./integrationSettings');

async function getStripeClient() {
  const secretKey = await integrationSettings.getSetting('stripe_secret_key');
  if (!secretKey) return null;
  const Stripe = require('stripe');
  return Stripe(secretKey);
}

async function getStripeWebhookSecret() {
  return integrationSettings.getSetting('stripe_webhook_secret');
}

module.exports = { getStripeClient, getStripeWebhookSecret };
