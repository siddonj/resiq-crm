#!/usr/bin/env node

/**
 * ResiQ CRM Database Migration Runner
 * Standalone version with inline pg connection (minimal dependencies)
 * Usage: npm run migrate
 * 
 * This script applies all SQL migrations from database/migrations/ in order.
 * Idempotent design allows safe re-runs.
 */

const fs = require('fs');
const path = require('path');

// Load .env file manually (no dotenv dependency)
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^["']|["']$/g, '');
          if (key && !process.env[key]) {
            process.env[key] = value;
          }
        }
      });
    }
  } catch (err) {
    console.error('Warning: Could not load .env file:', err.message);
  }
}

loadEnv();

// Dynamically require pg with helpful error message
let Client;
try {
  Client = require('pg').Client;
} catch (err) {
  console.error('\n❌ Error: PostgreSQL client (pg) not installed\n');
  console.log('Please run one of the following:');
  console.log('  npm install          # Install root dependencies');
  console.log('  npm install:all      # Install all dependencies (recommended)\n');
  process.exit(1);
}

async function runMigrations() {
  // Validate DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('\n❌ Error: DATABASE_URL environment variable not set\n');
    console.log('Please configure DATABASE_URL in your .env file:');
    console.log('  DATABASE_URL=postgresql://user:password@localhost:5432/resiq_crm\n');
    console.log('Example with local PostgreSQL:');
    console.log('  DATABASE_URL=postgresql://postgres:password@localhost:5432/resiq_crm\n');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('🔌 Connecting to database...');
    console.log(`   URL: ${process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}\n`);
    await client.connect();
    console.log('✓ Connected to database\n');

    const migrationsDir = path.join(__dirname, 'database', 'migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      console.error(`❌ Error: migrations directory not found at ${migrationsDir}`);
      process.exit(1);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('⚠️  No migration files found in database/migrations/');
      process.exit(0);
    }

    console.log(`📋 Found ${files.length} migration files\n`);

    let successCount = 0;
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      try {
        console.log(`▶️  Running: ${file}`);
        await client.query(sql);
        console.log(`✅ ${file} completed\n`);
        successCount++;
      } catch (err) {
        // Check if it's an "already exists" error (idempotent)
        if (err.message.includes('already exists') || 
            err.message.includes('duplicate key') ||
            err.code === '42P07' || 
            err.code === '42701') {
          console.log(`⏭️  ${file} (already applied)\n`);
          successCount++;
        } else {
          console.error(`❌ ${file} failed:`);
          console.error(`   ${err.message}\n`);
          throw err;
        }
      }
    }

    console.log(`\n✅ All migrations completed successfully! (${successCount}/${files.length})`);
    console.log('\n📊 Database schema is now up-to-date.');
    console.log('🚀 You can now start the application: npm run dev\n');
  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(`   ${error.message}\n`);
    console.log('⚠️  Troubleshooting:');
    console.log('   1. Verify DATABASE_URL is correct in .env');
    console.log('   2. Ensure PostgreSQL server is running');
    console.log('   3. Check database credentials and permissions');
    console.log('   4. Verify the database exists\n');
    console.log('Example setup:');
    console.log('   createdb resiq_crm');
    console.log('   psql resiq_crm < database/schema.sql\n');
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
