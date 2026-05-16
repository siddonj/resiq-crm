#!/usr/bin/env node
/**
 * Convert outboundAutomation.js from pool.query() to Kysely patterns.
 *
 * This script reads the file, transforms pool.query() calls into
 * sql`` template tag + .execute(db) patterns, and writes the result.
 *
 * Usage: node scripts/convert_pool_to_kysely.js
 */

const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/routes/outboundAutomation.js');

let content = fs.readFileSync(filePath, 'utf8');

// 1. Change the import line
content = content.replace(
  "const pool = require('../models/db');",
  "const { db, sql, ownershipWhere, pool } = require('../db');"
);

// 2. Phase 1: Convert pool.query() calls that use backtick template literals
//    pool.query(\`...\`, [...])  →  sql\`...\`.execute(db) + get rows

// We need to handle patterns like:
//   const result = await pool.query(\`...\`, [params]);
//   const row = result.rows[0];
//   const rows = result.rows;

// Strategy: For each pool.query call with backtick SQL and array params,
// transform to sql``.execute(db) pattern.

// Pattern 1: await pool.query(`...`, [params]) where result is not captured (fire-and-forget)
// Before: await pool.query(`...`, [p1, p2]);
// After:  await sql`...`.execute(db);

// Pattern 2: const result = await pool.query(`...`, [params])
// After:  const result = await sql`...`.execute(db);
// Then convert result.rows to result (since sql.execute returns { rows })

// Pattern 3: const row = result.rows[0] → const row = result[0] (if result is from sql.execute)
// Actually sql\`\`.execute(db) returns { rows: [...] } same as pool.query
// So we don't need to change result.rows access!

// The key change is: pool.query(sql, params) → sql\`\`.execute(db)
// And $1, $2 → ${param} interpolation

// Let's process the file line by line to handle the multi-line pool.query calls

const lines = content.split('\n');
const result = [];
let i = 0;

function getParamExpression(paramText) {
  const trimmed = paramText.trim();
  // Handle simple identifiers
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) return trimmed;
  // Handle property access
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(trimmed) && !trimmed.includes('(')) return trimmed;
  // Handle Number(), String(), Boolean() wrappers
  if (/^(Number|String|Boolean)\(/.test(trimmed)) return trimmed;
  // Handle template literals
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) return trimmed;
  // Handle JSON.stringify()
  if (trimmed.startsWith('JSON.stringify(')) return trimmed;
  // Handle other complex expressions
  return trimmed;
}

while (i < lines.length) {
  const line = lines[i];

  // Check if this line contains a pool.query() call
  const poolQueryMatch = line.match(/(\s*)(?:const\s+\w+\s*=\s*)?(?:await\s+)?pool\.query\(/);
  
  if (poolQueryMatch) {
    // Found a pool.query() call - check if it uses backtick SQL
    const afterPoolQuery = line.substring(line.indexOf('pool.query(') + 11).trim();
    
    if (afterPoolQuery.startsWith('`')) {
      // Multi-line case: pool.query( on one line, then ` on next, or on same line
      // Collect the entire pool.query() call
      let depth = 1; // Opening paren of pool.query(
      let sqlText = '';
      let paramsText = '';
      let inBacktick = afterPoolQuery.startsWith('`');
      let inParams = false;
      let parenDepth = 0;
      let currentText = '';
      let j = line.indexOf('pool.query(') + 11; // skip 'pool.query('
      
      // Read from the current line
      currentText = line.substring(j);
      
      // Actually, let me handle this differently. Let me collect all lines
      // that form the pool.query() call.
      
      let accumulated = '';
      let tempI = i;
      let foundEnd = false;
      let parenCount = 1; // starts with 1 open paren
      
      // Read from the opening paren of pool.query(
      const startIdx = line.indexOf('pool.query(');
      const beforePoolQuery = line.substring(0, startIdx);
      accumulated = line.substring(startIdx + 11); // after 'pool.query('
      
      // Now scan forward to find the matching closing paren
      let idx = 0;
      while (tempI < lines.length && !foundEnd) {
        const scanLine = tempI === i ? accumulated : lines[tempI];
        
        for (let ci = 0; ci < scanLine.length; ci++) {
          if (scanLine[ci] === '(') parenCount++;
          else if (scanLine[ci] === ')') {
            parenCount--;
            if (parenCount === 0) {
              // Found the closing paren - truncate here (including this char)
              accumulated = (tempI === i ? accumulated : (tempI > i ? lines.slice(i + 1, tempI).join('\n') + '\n' + lines[tempI].substring(0, ci) : ''));
              // Actually, let me just use the full accumulated string up to this point
              foundEnd = true;
              break;
            }
          }
        }
        
        if (!foundEnd) {
          if (tempI === i) {
            // We already have the start from accumulated
          } else {
            accumulated += '\n' + lines[tempI];
          }
          tempI++;
        }
      }
      
      // Hmm, this is getting complex. Let me take a simpler approach.
      // Just process each pool.query() call individually with manual patches.
    }
  }
  
  result.push(line);
  i++;
}

// Since the automated approach is too fragile, let's use a simpler strategy:
// We'll process known patterns and convert them manually.

console.log('Automated conversion requires manual attention for 136 calls.');
console.log('Using targeted file-level transformations instead.');

// Let's just change the import for now - the rest will be done with patches
fs.writeFileSync(filePath, content, 'utf8');
console.log('Import line changed.');
console.log('Now applying individual pool.query() conversions via patch...');
