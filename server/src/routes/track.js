const express = require('express');
const router = express.Router();
const pool = require('../models/db');

router.get('/pixel.png', async (req, res) => {
  try {
    if (req.query.d) {
      const data = JSON.parse(Buffer.from(req.query.d, 'base64').toString('utf8'));
      if (data.contactId && data.userId) {
        await pool.query(
          'INSERT INTO activities (user_id, contact_id, type, description) VALUES ($1, $2, $3, $4)',
          [data.userId, data.contactId, 'email_opened', data.subject ? `Opened email: ${data.subject}` : 'Opened tracked email']
        );
      }
    }
  } catch(e) {
    console.error('Pixel tracking error:', e);
  }
  
  const pixel = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private'
  });
  res.end(pixel);
});

router.get('/link', async (req, res) => {
  let targetUrl = '/';
  try {
    if (req.query.d) {
      const data = JSON.parse(Buffer.from(req.query.d, 'base64').toString('utf8'));
      if (data.url) targetUrl = data.url;
      
      if (data.contactId && data.userId) {
        await pool.query(
          'INSERT INTO activities (user_id, contact_id, type, description) VALUES ($1, $2, $3, $4)',
          [data.userId, data.contactId, 'link_clicked', data.url ? `Clicked tracked link to ${data.url}` : 'Clicked tracked link']
        );
      }
    }
  } catch(e) {
    console.error('Link tracking error:', e);
  }
  res.redirect(targetUrl);
});

module.exports = router;
