const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ResiQ CRM API running' });
});

app.use('/api/auth', require('./routes/auth'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
