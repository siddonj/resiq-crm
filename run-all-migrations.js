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
    if (!fs.existsSync(envPath)) {
      console.error('\n❌ Error: .env file not found at', envPath);
      process.exit(1);
    }
    
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Parse KEY=VALUE
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      
      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // Only set if not already in process.env (don't override command-line args)
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.error('\n❌ Warning: Could not load .env file:', err.message);
    process.exit(1);
  }
}

loadEnv();

// Debug: show what we loaded
if (!process.env.DATABASE_URL) {
  console.error('\n❌ Error: DATABASE_URL not found after loading .env\n');
  console.log('Loaded environment variables:');
  Object.keys(process.env)
    .filter(k => k.includes('DATABASE') || k.includes('POSTGRES'))
    .forEach(k => console.log(`  ${k}=${process.env[k]}`));
  console.log('\nPlease check your .env file has DATABASE_URL set.\n');
  process.exit(1);
}

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
