const express = require('express');
const { handlePaymentIntentSucceeded, handlePaymentIntentFailed, generateStripePaymentLink } = require('../services/stripeWebhooks');

const router = express.Router();

// Only initialize Stripe if API key is provided
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

/**
 * POST /api/stripe/webhook
 * Webhook handler for Stripe events
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).json({ error: 'Missing webhook signature or secret' });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // Handle specific events
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).json({ error: 'Webhook Error: ' + err.message });
  }
});

/**
 * POST /api/stripe/create-payment-link
 * Create a Stripe payment link for an invoice
 * Requires: invoiceId, invoiceNumber, amount
 */
router.post('/create-payment-link', async (req, res) => {
  const { invoiceId, invoiceNumber, amount, description } = req.body;

  if (!invoiceId || !invoiceNumber || !amount) {
    return res.status(400).json({ error: 'invoiceId, invoiceNumber, and amount are required' });
  }

  try {
    const paymentLink = await generateStripePaymentLink(
      invoiceId,
      invoiceNumber,
      amount,
      description
    );

    res.json({
      success: true,
      paymentLink,
    });
  } catch (err) {
    console.error('Error creating payment link:', err);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});

module.exports = router;
