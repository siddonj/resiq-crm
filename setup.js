#!/usr/bin/env node

/**
 * ResiQ CRM Quick Setup Script
 * Installs dependencies and runs migrations
 * Usage: node setup.js
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const isWindows = process.platform === 'win32';

console.log('\n🚀 ResiQ CRM Quick Setup\n');
console.log('=' .repeat(50));

// Step 1: Check .env
console.log('\n📋 Step 1: Checking configuration...');
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.log('⚠️  .env file not found');
  console.log('   Creating from .env.example...\n');
  const examplePath = path.join(__dirname, '.env.example');
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('✓ .env file created');
    console.log('  ⚠️  Please edit .env to add your configuration');
    console.log('  Required: DATABASE_URL, SMTP credentials\n');
  }
} else {
  console.log('✓ .env file exists');
}

// Step 2: Install dependencies
console.log('📦 Step 2: Installing dependencies...\n');

const commands = [
  { name: 'Root dependencies', cmd: 'npm install' },
  { name: 'Server dependencies', cmd: isWindows ? 'npm --prefix server install' : 'npm --prefix server install' },
  { name: 'Client dependencies', cmd: isWindows ? 'npm --prefix client install' : 'npm --prefix client install' }
];

async function runCommands() {
  for (const { name, cmd } of commands) {
    console.log(`▶️  Installing ${name}...`);
    try {
      await new Promise((resolve, reject) => {
        exec(cmd, { cwd: __dirname }, (error, stdout, stderr) => {
          if (error) {
            // Check if it's just warnings
            if (stderr && stderr.includes('npm WARN')) {
              console.log(`✓ ${name} installed (with warnings)`);
              resolve();
            } else {
              reject(error);
            }
          } else {
            console.log(`✓ ${name} installed`);
            resolve();
          }
        });
      });
    } catch (error) {
      console.error(`❌ Failed to install ${name}:`);
      console.error(error.message);
      process.exit(1);
    }
  }

  // Step 3: Run migrations
  console.log('\n🗄️  Step 3: Running database migrations...\n');
  try {
    await new Promise((resolve, reject) => {
      exec('npm run migrate', { cwd: __dirname }, (error, stdout, stderr) => {
        console.log(stdout);
        if (stderr && !stderr.includes('npm WARN')) {
          console.error(stderr);
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('❌ Migration failed:');
    console.error(error.message);
    console.log('\nTroubleshooting:');
    console.log('  1. Ensure PostgreSQL is running');
    console.log('  2. Check DATABASE_URL in .env');
    console.log('  3. Run manually: npm run migrate\n');
    process.exit(1);
  }

  // Done!
  console.log('\n' + '='.repeat(50));
  console.log('✅ Setup completed successfully!\n');
  console.log('🚀 Next steps:');
  console.log('   1. Edit .env with your configuration');
  console.log('   2. Start development: npm run dev');
  console.log('   3. Open browser: http://localhost:5173\n');
  console.log('📚 Full setup guide: See SETUP.md\n');
}

runCommands();
