const express = require('express');
const compliance = require('../services/outbound/complianceService');

const router = express.Router();

// Public (no auth) — recipients click this from outbound emails.

function page(title, message) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px 40px;max-width:440px;text-align:center}
h1{font-size:18px;margin:0 0 12px}p{color:#94a3b8;line-height:1.5;margin:0 0 20px}
button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>${title.includes('Confirm') ?
  '<form method="POST"><button type="submit">Unsubscribe me</button></form>' : ''}</div></body></html>`;
}

/**
 * GET /api/unsubscribe/:token
 * Browser confirmation page (also satisfies List-Unsubscribe URL).
 */
router.get('/:token', (req, res) => {
  const data = compliance.verifyUnsubscribeToken(req.params.token);
  if (!data) {
    return res.status(400).send(page('Invalid link', 'This unsubscribe link is invalid or has expired.'));
  }
  res
    .status(200)
    .send(page('Confirm unsubscribe', `Click below to stop receiving emails at <strong>${data.email}</strong>.`));
});

/**
 * POST /api/unsubscribe/:token
 * One-click unsubscribe (RFC 8058 List-Unsubscribe-Post target).
 */
router.post('/:token', async (req, res) => {
  const data = compliance.verifyUnsubscribeToken(req.params.token);
  if (!data) {
    return res.status(400).send(page('Invalid link', 'This unsubscribe link is invalid or has expired.'));
  }
  try {
    await compliance.recordOptOut({ userId: data.userId, email: data.email, channel: 'email', source: 'opt_out' });
    res.status(200).send(page('Unsubscribed', `${data.email} has been removed. You will no longer receive these emails.`));
  } catch (err) {
    console.error('Unsubscribe failed:', err);
    res.status(500).send(page('Something went wrong', 'We could not process your request. Please try again later.'));
  }
});

module.exports = router;
