const crypto = require('crypto');

// HMAC-signs the base64 tracking payload embedded in pixel/link URLs so the
// receiving route (track.js GET /pixel.png, GET /link) can detect tampering
// before trusting data.userId/data.contactId for org resolution. Reuses
// JWT_SECRET (the existing server-side signing secret convention — see
// middleware/auth.js) rather than introducing a second secret to manage.
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured; required to sign tracking payloads');
  }
  return secret;
}

function sign(base64Data) {
  return crypto.createHmac('sha256', getSecret()).update(base64Data).digest('hex');
}

// Constant-time comparison via crypto.timingSafeEqual to avoid a timing
// side-channel on signature verification.
function verify(base64Data, signature) {
  if (typeof signature !== 'string' || signature.length === 0) return false;

  const expected = sign(base64Data);
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(signature, 'hex');

  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

module.exports = { sign, verify };
