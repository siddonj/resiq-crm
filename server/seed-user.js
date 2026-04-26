const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const client = new Client({
  connectionString: 'postgresql://resiq:resiq_dev@localhost:5434/resiq_crm'
});

async function main() {
  try {
    await client.connect();
    // Default admin password
    const hash = await bcrypt.hash('password123', 10);
    
    await client.query(`
      INSERT INTO users (name, email, password_hash, role) 
      VALUES ('Admin', 'admin@resiq.com', $1, 'admin')
      ON CONFLICT (email) DO UPDATE SET password_hash = $1
    `, [hash]);

    console.log('✅ Admin user ready!');
    console.log('Email: admin@resiq.com');
    console.log('Password: password123');

  } catch (err) {
    console.error('Error seeding user:', err.message);
  } finally {
    await client.end();
  }
}

main();