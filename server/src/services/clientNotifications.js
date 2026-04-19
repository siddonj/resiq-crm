const nodemailer = require('nodemailer')
const pool = require('../models/db')

/**
 * Initialize email transporter
 * Uses SMTP or Gmail credentials from environment
 */
function getTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  }

  // Fallback to Gmail (requires app password)
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

const transporter = getTransporter()

/**
 * Send client invitation email
 * Called when employee invites a client
 */
async function sendClientInvitationEmail(email, name, invitationToken) {
  try {
    const inviteLink = `${process.env.CLIENT_PORTAL_URL || 'http://localhost:3000'}/client/login?token=${invitationToken}`

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">ResiQ CRM</h1>
              <p style="margin: 10px 0 0 0;">You're invited to the client portal</p>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              <p>You've been invited to access your project portal on ResiQ CRM. Here you can view proposals, invoices, and track project progress.</p>
              
              <p style="text-align: center;">
                <a href="${inviteLink}" class="button">Access Your Portal</a>
              </p>
              
              <p style="background: #e8f4f8; padding: 15px; border-radius: 5px; border-left: 4px solid #667eea;">
                <strong>First Time?</strong><br>
                Click the button above. You'll set up your account in just a few clicks.
              </p>
              
              <p><strong>Why use ResiQ?</strong></p>
              <ul>
                <li>📄 Review and sign proposals digitally</li>
                <li>💳 View invoices and make secure payments</li>
                <li>📁 Access shared files and documents</li>
                <li>⏱️ Track project activity and progress</li>
              </ul>
              
              <p style="color: #666; font-size: 13px;">
                This invitation link expires in 48 hours for security.
              </p>
            </div>
            <div class="footer">
              <p>© 2026 ResiQ CRM. All rights reserved.</p>
              <p>If you didn't expect this invitation, please contact your project manager.</p>
            </div>
          </div>
        </body>
      </html>
    `

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_USER,
      to: email,
      subject: `You're invited to access your project on ResiQ`,
      html: htmlContent,
      text: `Hi ${name}, you've been invited to access the ResiQ client portal. Click here: ${inviteLink}`,
    })

    console.log(`✓ Client invitation sent to ${email}`)
    return true
  } catch (err) {
    console.error(`Failed to send invitation email to ${email}:`, err.message)
    return false
  }
}

/**
 * Send proposal sent notification to client
 */
async function sendProposalSentEmail(clientEmail, clientName, proposalTitle) {
  try {
    const portalLink = `${process.env.CLIENT_PORTAL_URL || 'http://localhost:3000'}/client/proposals`

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
            .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">📄 New Proposal</h1>
              <p style="margin: 10px 0 0 0;">A new proposal is ready for your review</p>
            </div>
            <div class="content">
              <p>Hi ${clientName},</p>
              <p>A new proposal has been sent to you: <strong>${proposalTitle}</strong></p>
              
              <p style="text-align: center;">
                <a href="${portalLink}" class="button">Review Proposal</a>
              </p>
              
              <div class="alert">
                <strong>Action Needed:</strong> Please review the proposal and sign it when you're ready.
              </div>
              
              <p>You can access your portal anytime to:</p>
              <ul>
                <li>View proposal details and pricing</li>
                <li>Sign with your digital signature</li>
                <li>Track approval status</li>
              </ul>
            </div>
            <div class="footer">
              <p>© 2026 ResiQ CRM. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_USER,
      to: clientEmail,
      subject: `New proposal: ${proposalTitle}`,
      html: htmlContent,
      text: `A new proposal "${proposalTitle}" has been sent to you. Review it at: ${portalLink}`,
    })

    console.log(`✓ Proposal notification sent to ${clientEmail}`)
    return true
  } catch (err) {
    console.error(`Failed to send proposal email to ${clientEmail}:`, err.message)
    return false
  }
}

/**
 * Send invoice sent notification to client
 */
async function sendInvoiceSentEmail(clientEmail, clientName, invoiceNumber, amount, dueDate) {
  try {
    const portalLink = `${process.env.CLIENT_PORTAL_URL || 'http://localhost:3000'}/client/invoices`
    const dueDateStr = new Date(dueDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #f5576c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
            .invoice-details { background: white; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f5576c; }
            .amount { font-size: 24px; font-weight: bold; color: #f5576c; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">💳 Invoice #${invoiceNumber}</h1>
              <p style="margin: 10px 0 0 0;">Your invoice is ready</p>
            </div>
            <div class="content">
              <p>Hi ${clientName},</p>
              <p>Your invoice #<strong>${invoiceNumber}</strong> is ready for payment.</p>
              
              <div class="invoice-details">
                <p style="margin: 0; color: #666;">Amount Due</p>
                <p class="amount" style="margin: 5px 0 0 0;">$${amount.toFixed(2)}</p>
                <p style="margin: 10px 0 0 0; font-size: 13px; color: #666;">
                  Due by: <strong>${dueDateStr}</strong>
                </p>
              </div>
              
              <p style="text-align: center;">
                <a href="${portalLink}" class="button">Pay Invoice Online</a>
              </p>
              
              <p>You can securely pay your invoice using our online payment system. We accept credit cards and other payment methods.</p>
              
              <p style="background: #e8f4f8; padding: 15px; border-radius: 5px; border-left: 4px solid #f5576c;">
                <strong>Quick Links:</strong><br>
                • View invoice details<br>
                • Download PDF copy<br>
                • Make a payment<br>
                All available in your client portal
              </p>
            </div>
            <div class="footer">
              <p>© 2026 ResiQ CRM. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_USER,
      to: clientEmail,
      subject: `Invoice #${invoiceNumber} - ${amount.toFixed(2)} due by ${dueDateStr}`,
      html: htmlContent,
      text: `Invoice #${invoiceNumber} for $${amount.toFixed(2)} is due by ${dueDateStr}. Pay at: ${portalLink}`,
    })

    console.log(`✓ Invoice notification sent to ${clientEmail}`)
    return true
  } catch (err) {
    console.error(`Failed to send invoice email to ${clientEmail}:`, err.message)
    return false
  }
}

/**
 * Send proposal signed confirmation to employee
 */
async function sendProposalSignedConfirmation(employeeEmail, clientName, proposalTitle, signedAt) {
  try {
    const signedDate = new Date(signedAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #84fab0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
            .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 15px; border-radius: 5px; margin: 20px 0; color: #155724; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">✓ Proposal Signed!</h1>
              <p style="margin: 10px 0 0 0;">Client approved your proposal</p>
            </div>
            <div class="content">
              <p>Great news!</p>
              
              <div class="success-box">
                <strong>Proposal Signed</strong><br>
                <strong>Client:</strong> ${clientName}<br>
                <strong>Proposal:</strong> ${proposalTitle}<br>
                <strong>Signed:</strong> ${signedDate}
              </div>
              
              <p>The client has approved your proposal and it's now signed. You can proceed with the next steps.</p>
              
              <p style="background: #e8f4f8; padding: 15px; border-radius: 5px; border-left: 4px solid #28a745;">
                <strong>Next Steps:</strong><br>
                • Create an invoice for this proposal<br>
                • Schedule a kick-off meeting<br>
                • Update the deal status
              </p>
            </div>
            <div class="footer">
              <p>© 2026 ResiQ CRM. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_USER,
      to: employeeEmail,
      subject: `✓ Proposal signed by ${clientName}: ${proposalTitle}`,
      html: htmlContent,
      text: `Proposal signed! ${clientName} has signed "${proposalTitle}" at ${signedDate}`,
    })

    console.log(`✓ Proposal signed confirmation sent to ${employeeEmail}`)
    return true
  } catch (err) {
    console.error(`Failed to send proposal signed email to ${employeeEmail}:`, err.message)
    return false
  }
}

/**
 * Send invoice paid confirmation to employee
 */
async function sendInvoicePaidConfirmation(employeeEmail, clientName, invoiceNumber, amount, paidAt) {
  try {
    const paidDate = new Date(paidAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
            .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 15px; border-radius: 5px; margin: 20px 0; color: #155724; }
            .amount { font-size: 28px; font-weight: bold; color: #28a745; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">💰 Payment Received!</h1>
              <p style="margin: 10px 0 0 0;">Invoice #${invoiceNumber} has been paid</p>
            </div>
            <div class="content">
              <p>Excellent news!</p>
              
              <div class="success-box">
                <strong>Invoice Paid</strong><br>
                <strong>Client:</strong> ${clientName}<br>
                <strong>Invoice #:</strong> ${invoiceNumber}<br>
                <strong>Amount:</strong> <span class="amount">$${amount.toFixed(2)}</span><br>
                <strong>Received:</strong> ${paidDate}
              </div>
              
              <p>The client has successfully paid invoice #${invoiceNumber}. The payment has been processed and credited to your account.</p>
              
              <p style="background: #e8f4f8; padding: 15px; border-radius: 5px; border-left: 4px solid #28a745;">
                <strong>Thank You!</strong><br>
                Payment received in full for this invoice. Mark the deal as closed if this was the final payment.
              </p>
            </div>
            <div class="footer">
              <p>© 2026 ResiQ CRM. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_USER,
      to: employeeEmail,
      subject: `✓ Invoice #${invoiceNumber} paid by ${clientName} ($${amount.toFixed(2)})`,
      html: htmlContent,
      text: `Invoice #${invoiceNumber} for $${amount.toFixed(2)} has been paid by ${clientName} at ${paidDate}`,
    })

    console.log(`✓ Invoice paid confirmation sent to ${employeeEmail}`)
    return true
  } catch (err) {
    console.error(`Failed to send invoice paid email to ${employeeEmail}:`, err.message)
    return false
  }
}

module.exports = {
  sendClientInvitationEmail,
  sendProposalSentEmail,
  sendInvoiceSentEmail,
  sendProposalSignedConfirmation,
  sendInvoicePaidConfirmation,
}
