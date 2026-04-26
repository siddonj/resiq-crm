require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    const file = path.join(__dirname, '../database/migrations/009-add-sequences.sql');
    const sql = fs.readFileSync(file, 'utf8');
    try {
        await pool.query(sql);
        console.log('Successfully ran 009-add-sequences.sql');
    } catch (e) {
        console.error('Error running migration:', e);
    }
    pool.end();
}
run();
