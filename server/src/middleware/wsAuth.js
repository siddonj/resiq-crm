// WebSocket authentication middleware
const jwt = require('jsonwebtoken');

// Parse token from WebSocket request
function getTokenFromRequest(req) {
  // Try to get from Sec-WebSocket-Protocol header first
  const protocol = req.headers['sec-websocket-protocol'];
  if (protocol && protocol.includes('Bearer')) {
    return protocol.split(' ')[1];
  }

  // Try query string
  if (req.url && req.url.includes('?token=')) {
    const urlParams = new URL(`http://localhost${req.url}`);
    return urlParams.searchParams.get('token');
  }

  return null;
}

function verifyWebSocketToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = {
  getTokenFromRequest,
  verifyWebSocketToken,
};
