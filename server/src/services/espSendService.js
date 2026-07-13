const axios = require('axios');
const integrationSettings = require('./integrationSettings');
const compliance = require('./outbound/complianceService');

/**
 * Provider-agnostic ESP transport for outbound email.
 *
 * Currently SendGrid-only (v3 mail/send via API key), but every caller goes
 * through sendEmail() so an SES/other backend can be added behind the same
 * signature later. Callers are responsible for compliance checks and footer
 * construction BEFORE calling this; this layer only transmits.
 */

const SENDGRID_SEND_URL = 'https://api.sendgrid.com/v3/mail/send';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Plain-text draft bodies become a minimal HTML part (links clickable,
 * newlines preserved) so open/click tracking works, alongside the text part.
 */
function textToHtml(text) {
  const escaped = escapeHtml(text);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}">${url}</a>`
  );
  return `<div style="white-space:pre-wrap;font-family:inherit;">${linked}</div>`;
}

/**
 * Send one email through the configured ESP.
 *
 * @param {Object} opts
 * @param {string} opts.userId - sender user (used for unsubscribe headers + webhook mapping)
 * @param {Object|null} opts.mailbox - outbound_mailboxes row; from-address comes from here
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.html] - HTML body; derived from text when omitted
 * @param {string} [opts.text] - plain-text body
 * @param {string} [opts.fromName]
 * @param {Object} [opts.metadata] - custom_args echoed back on webhook events
 *   (e.g. { draftId, enrollmentId, mailboxId })
 * @returns {Promise<{messageId: string|null}>}
 */
async function sendEmail({ userId, mailbox = null, to, subject, html = null, text = null, fromName = null, metadata = {} }) {
  const apiKey = String((await integrationSettings.getSetting('sendgrid_api_key')) || '').trim();
  if (!apiKey) {
    const err = new Error('SendGrid is not configured. Add the API key in Integration Settings.');
    err.statusCode = 503;
    throw err;
  }

  const fromEmail = mailbox?.email || (await integrationSettings.getSetting('outbound_from_default'));
  if (!fromEmail) {
    const err = new Error('No sending mailbox or default from-address configured.');
    err.statusCode = 503;
    throw err;
  }
  if (!to || !subject || (!html && !text)) {
    throw new Error('to, subject, and a body are required to send email.');
  }

  const unsubUrl = compliance.unsubscribeUrl(userId, to);
  const content = [];
  if (text) content.push({ type: 'text/plain', value: text });
  content.push({ type: 'text/html', value: html || textToHtml(text) });

  const payload = {
    personalizations: [
      {
        to: [{ email: to }],
        custom_args: Object.fromEntries(
          Object.entries({ userId, ...metadata }).filter(([, v]) => v !== null && v !== undefined)
            .map(([k, v]) => [k, String(v)])
        ),
      },
    ],
    from: { email: fromEmail, ...(fromName ? { name: fromName } : {}) },
    subject,
    content,
    headers: {
      // RFC 8058 one-click unsubscribe; the POST endpoint already exists at
      // /api/unsubscribe (routes/unsubscribe.js).
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tracking_settings: {
      open_tracking: { enable: true },
      click_tracking: { enable: true, enable_text: false },
    },
  };

  try {
    const res = await axios.post(SENDGRID_SEND_URL, payload, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return { messageId: res.headers['x-message-id'] || null };
  } catch (err) {
    const detail = err.response?.data?.errors?.map((e) => e.message).join('; ') || err.message;
    const wrapped = new Error(`ESP send failed: ${detail}`);
    wrapped.statusCode = err.response?.status === 401 ? 503 : 502;
    wrapped.cause = err;
    throw wrapped;
  }
}

/**
 * Validate the configured (or override) API key against SendGrid.
 * Used by the integration-settings connection tester.
 */
async function testConnection(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key.startsWith('SG.')) {
    throw new Error('That does not look like a SendGrid API key — keys start with "SG.". Make sure you copied the full key (shown only once at creation), not the Key ID.');
  }
  try {
    const res = await axios.get('https://api.sendgrid.com/v3/scopes', {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 10000,
    });
    if (Array.isArray(res.data?.scopes) && !res.data.scopes.includes('mail.send')) {
      throw new Error('API key is valid but lacks the Mail Send permission.');
    }
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      throw new Error('SendGrid rejected the key (401). Copy the full key again — it is shown only once when created — and check for stray spaces.');
    }
    if (status === 403) {
      // Restricted keys can't read /v3/scopes; verify sendability instead via
      // a sandbox-mode send (validated but never delivered).
      await axios.post(
        SENDGRID_SEND_URL,
        {
          personalizations: [{ to: [{ email: 'test@example.com' }] }],
          from: { email: 'test@example.com' },
          subject: 'connection test',
          content: [{ type: 'text/plain', value: 'test' }],
          mail_settings: { sandbox_mode: { enable: true } },
        },
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      return;
    }
    throw err;
  }
}

module.exports = { sendEmail, testConnection, textToHtml };
