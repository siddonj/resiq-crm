const pool = require('../models/db');
const { sendInvoicePaidConfirmation } = require('./clientNotifications');

// Only initialize Stripe if API key is provided
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

/**
 * Handle Stripe payment intent succeeded event
 * Updates invoice status to "paid" when payment completes
 */
async function handlePaymentIntentSucceeded(paymentIntent) {
  try {
    // Look up invoice by Stripe payment URL or metadata
    const metadata = paymentIntent.metadata || {};

    if (!metadata.invoice_id) {
      console.warn('No invoice_id in payment intent metadata:', paymentIntent.id);
      return;
    }

    const invoiceId = metadata.invoice_id;
    const amountPaid = paymentIntent.amount / 100; // Convert cents to dollars

    // Update invoice status to paid
    const result = await pool.query(
      `UPDATE invoices 
       SET status = 'paid', paid_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id, line_items`,
      [invoiceId]
    );

    if (!result.rows[0]) {
      console.warn('Invoice not found:', invoiceId);
      return;
    }

    const invoice = result.rows[0];
    const totalAmount = invoice.line_items.reduce((sum, item) => sum + (item.amount || 0), 0);

    // Get employee email for confirmation
    const userResult = await pool.query(
      'SELECT email, name FROM users WHERE id = $1',
      [invoice.user_id]
    );

    const employee = userResult.rows[0];
    if (employee) {
      // Get client info
      const clientResult = await pool.query(
        `SELECT c.name, c.email FROM clients c
         INNER JOIN client_shared_items csi ON c.id = (
           SELECT client_id FROM client_shared_items WHERE item_id = $1 AND item_type = 'invoice' LIMIT 1
         )
         WHERE csi.item_id = $1`,
        [invoiceId]
      );

      if (clientResult.rows[0]) {
        const client = clientResult.rows[0];
        // Send confirmation email to employee
        await sendInvoicePaidConfirmation(
          employee.email,
          client.name,
          metadata.invoice_number || invoiceId,
          totalAmount,
          new Date()
        );
      }
    }

    console.log(`✓ Invoice ${invoiceId} marked as paid via Stripe (${amountPaid})`);
  } catch (err) {
    console.error('Error processing payment intent:', err);
  }
}

/**
 * Handle Stripe payment intent failed event
 * Logs failure for debugging
 */
async function handlePaymentIntentFailed(paymentIntent) {
  try {
    const metadata = paymentIntent.metadata || {};
    console.warn(`Payment failed for invoice ${metadata.invoice_id}:`, paymentIntent.last_payment_error);
  } catch (err) {
    console.error('Error handling payment failure:', err);
  }
}

/**
 * Generate Stripe payment link for invoice
 * Creates or retrieves existing payment link
 */
async function generateStripePaymentLink(invoiceId, invoiceNumber, amount, description) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  try {
    // Check if payment link already exists
    const checkResult = await pool.query(
      'SELECT stripe_payment_url FROM invoices WHERE id = $1',
      [invoiceId]
    );

    if (checkResult.rows[0]?.stripe_payment_url) {
      return checkResult.rows[0].stripe_payment_url;
    }

    // Create Stripe payment link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Invoice #${invoiceNumber}`,
              description: description || 'Project invoice',
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${process.env.CLIENT_PORTAL_URL || 'http://localhost:3000'}/client/invoices/${invoiceId}?paid=true`,
        },
      },
      billing_address_collection: 'required',
    });

    // Store payment link in database
    await pool.query(
      'UPDATE invoices SET stripe_payment_url = $1 WHERE id = $2',
      [paymentLink.url, invoiceId]
    );

    console.log(`✓ Payment link created for invoice ${invoiceId}`);
    return paymentLink.url;
  } catch (err) {
    console.error('Error creating Stripe payment link:', err);
    throw err;
  }
}

module.exports = {
  handlePaymentIntentSucceeded,
  handlePaymentIntentFailed,
  generateStripePaymentLink,
}
