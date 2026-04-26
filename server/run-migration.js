require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  await client.query("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;");
  await client.query("ALTER TABLE deals ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;");
  
  console.log('Migration complete.');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
