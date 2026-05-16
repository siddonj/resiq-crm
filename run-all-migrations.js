#!/usr/bin/env node

/**
 * ResiQ CRM Database Migration Runner
 * Standalone version with inline pg connection (minimal dependencies)
 * Usage: npm run migrate
 * 
 * This script applies all SQL migrations from database/migrations/ in order.
 * Tracks applied migrations in the _schema_version table for idempotent re-runs.
 */

const fs = require('fs');
const path = require('path');

// Load .env file manually (no dotenv dependency)
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
      console.error('\nError: .env file not found at', envPath);
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
    console.error('\nWarning: Could not load .env file:', err.message);
    process.exit(1);
  }
}

loadEnv();

// Debug: show what we loaded
if (!process.env.DATABASE_URL) {
  console.error('\nError: DATABASE_URL not found after loading .env\n');
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
  console.error('\nError: PostgreSQL client (pg) not installed\n');
  console.log('Please run one of the following:');
  console.log('  npm install          # Install root dependencies');
  console.log('  npm install:all      # Install all dependencies (recommended)\n');
  process.exit(1);
}

async function runMigrations() {
  // Validate DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('\nError: DATABASE_URL environment variable not set\n');
    console.log('Please configure DATABASE_URL in your .env file:');
    console.log('  DATABASE_URL=postgresql://user:***@localhost:5432/resiq_crm\n');
    console.log('Example with local PostgreSQL:');
    console.log('  DATABASE_URL=postgresql://postgres:***@localhost:5432/resiq_crm\n');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('Connecting to database...');
    console.log(`   URL: ${process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}\n`);
    await client.connect();
    console.log('Connected to database\n');

    // Acquire advisory lock — prevents two concurrent migration runs
    try {
      await client.query("SELECT pg_advisory_xact_lock(847261004)");
    } catch (_) {
      // Proceed if lock unavailable
    }

    // Ensure _schema_version tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _schema_version (
        version     TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum    TEXT
      )
    `);

    // Apply base schema first (creates users, contacts, deals, etc.)
    const schemaFile = path.join(__dirname, 'database', 'schema.sql');
    if (fs.existsSync(schemaFile)) {
      const schemaSql = fs.readFileSync(schemaFile, 'utf8');
      console.log('Applying base schema (database/schema.sql)...');
      try {
        await client.query(schemaSql);
        console.log('Base schema applied\n');
      } catch (err) {
        if (err.message.includes('already exists') ||
            err.message.includes('duplicate key') ||
            err.code === '42P07' ||
            err.code === '42701' ||
            err.code === '42710') {
          console.log('Base schema (already applied)\n');
        } else {
          throw err;
        }
      }
    }

    const migrationsDir = path.join(__dirname, 'database', 'migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      console.error('Error: migrations directory not found at', migrationsDir);
      process.exit(1);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found in database/migrations/');
      process.exit(0);
    }

    console.log(`Found ${files.length} migration files\n`);

    let successCount = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');

      // Check if already applied (using _schema_version)
      const { rows: existing } = await client.query(
        'SELECT 1 FROM _schema_version WHERE version = $1',
        [version]
      );
      if (existing.length > 0) {
        console.log(`  ${file} (already applied)\n`);
        successCount++;
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      try {
        console.log(`  Running: ${file}`);
        await client.query(sql);

        // Record as applied
        await client.query(
          'INSERT INTO _schema_version (version, description) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [version, file]
        );

        console.log(`  ${file} completed\n`);
        successCount++;
      } catch (err) {
        // Check if it's an "already exists" error (idempotent fallback)
        if (err.message.includes('already exists') || 
            err.message.includes('duplicate key') ||
            err.code === '42P07' || 
            err.code === '42701') {
          // Record as applied even on idempotent re-run
          try {
            await client.query(
              'INSERT INTO _schema_version (version, description) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [version, file]
            );
          } catch (_) {}
          console.log(`  ${file} (already applied, idempotent)\n`);
          successCount++;
        } else {
          console.error(`  ${file} failed:`);
          console.error(`   ${err.message}\n`);
          throw err;
        }
      }
    }

    console.log(`\nAll migrations completed successfully! (${successCount}/${files.length})`);
    console.log('Database schema is now up-to-date.');
    console.log('You can now start the application: npm run dev\n');
  } catch (error) {
    console.error('\nMigration failed:');
    console.error(`   ${error.message}\n`);
    console.log('Troubleshooting:');
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
