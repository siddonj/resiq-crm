#!/usr/bin/env node
/**
 * Batch convert pool.query() calls to sql\`\` patterns in outboundAutomation.js
 * 
 * This script handles multi-line pool.query() calls with backtick SQL.
 * It replaces:
 *   pool.query(
 *     \`SQL WITH $1, $2...\`,
 *     [param1, param2, ...]
 *   );
 * With:
 *   sql\`SQL WITH \${param1}, \${param2}...\`.execute(db)
 */

const fs = require('fs');

const filePath = process.argv[2] || '/home/siddonj/resiq-crm-1/server/src/routes/outboundAutomation.js';
let content = fs.readFileSync(filePath, 'utf8');

// Process the file to find and transform pool.query() calls
// Strategy: Find each pool.query( ... ) call and transform it

// First, collect all pool.query() ranges
const pqRanges = [];
const poolQueryRegex = /pool\.query\(/g;
let match;

while ((match = poolQueryRegex.exec(content)) !== null) {
  const start = match.index;
  // Find the matching closing paren
  let depth = 1;
  let pos = match.index + match[0].length;
  let inBacktick = false;
  let backtickContent = null;
  
  while (pos < content.length && depth > 0) {
    const ch = content[pos];
    const prev = pos > 0 ? content[pos - 1] : '';
    
    if (ch === '`' && prev !== '\\') {
      inBacktick = !inBacktick;
    }
    
    if (!inBacktick) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    
    pos++;
  }
  
  pqRanges.push({ start, end: pos - 1 });
}

// Process in reverse order so we don't mess up positions
pqRanges.sort((a, b) => b.start - a.start);

let convertedCount = 0;
let skippedCount = 0;

for (const range of pqRanges) {
  const fullCall = content.substring(range.start, range.end + 1);
  
  // Extract the SQL and params
  // pool.query( SQL , PARAMS )
  // We need to find the SQL (backtick string) and the params array
  
  // Method: Extract the content between pool.query( and the last )
  const inner = fullCall.substring('pool.query('.length, fullCall.length - 1).trim();
  
  // Check if this is a template literal or a simple query
  if (inner.startsWith('`')) {
    // Backtick SQL - find the closing backtick
    let backtickEnd = -1;
    let inEscape = false;
    for (let ci = 1; ci < inner.length; ci++) {
      if (inEscape) { inEscape = false; continue; }
      if (inner[ci] === '\\') { inEscape = true; continue; }
      if (inner[ci] === '`') { backtickEnd = ci; break; }
    }
    
    if (backtickEnd === -1) {
      skippedCount++;
      continue;
    }
    
    const sqlContent = inner.substring(1, backtickEnd);
    
    // After the backtick, there should be a comma and then the params array
    let afterSQL = inner.substring(backtickEnd + 1).trim();
    
    // Handle template literal interpolation (${...}) inside the SQL
    // We already have the raw SQL content
    
    // Parse the params array: [...]
    let paramsArray = [];
    if (afterSQL.startsWith(',')) {
      afterSQL = afterSQL.substring(1).trim();
    }
    
    if (afterSQL.startsWith('[')) {
      // Parse the array
      let depth2 = 1;
      let arrayContent = '';
      let ci = 1;
      let inStr2 = false;
      let strChar2 = null;
      
      while (ci < afterSQL.length && depth2 > 0) {
        const ch = afterSQL[ci];
        const prevCh = ci > 0 ? afterSQL[ci - 1] : '';
        
        if (inStr2) {
          arrayContent += ch;
          if (ch === '\\' && prevCh !== '\\') {
            // skip next
          } else if (ch === strChar2) {
            inStr2 = false;
            strChar2 = null;
          }
          ci++;
          continue;
        }
        
        if (ch === "'" || ch === '"' || ch === '`') {
          inStr2 = true;
          strChar2 = ch;
          arrayContent += ch;
          ci++;
          continue;
        }
        
        if (ch === '[' || ch === '(' || ch === '{') {
          depth2++;
          arrayContent += ch;
          ci++;
          continue;
        }
        
        if (ch === ']' || ch === ')' || ch === '}') {
          depth2--;
          if (depth2 > 0) {
            arrayContent += ch;
          }
          ci++;
          continue;
        }
        
        if (ch === ',') {
          arrayContent += ch;
          ci++;
          continue;
        }
        
        arrayContent += ch;
        ci++;
      }
      
      // Parse the array into individual elements
      // Split by top-level commas
      let depth3 = 0;
      let current = '';
      let params = [];
      let inStr3 = false;
      let strChar3 = null;
      
      for (let ci2 = 0; ci2 < arrayContent.length; ci2++) {
        const ch = arrayContent[ci2];
        
        if (inStr3) {
          current += ch;
          if (ch === '\\') {
            if (ci2 + 1 < arrayContent.length) {
              current += arrayContent[++ci2];
            }
          } else if (ch === strChar3) {
            inStr3 = false;
            strChar3 = null;
          }
          continue;
        }
        
        if (ch === "'" || ch === '"' || ch === '`') {
          inStr3 = true;
          strChar3 = ch;
          current += ch;
          continue;
        }
        
        if (ch === '(' || ch === '[' || ch === '{') {
          depth3++;
          current += ch;
          continue;
        }
        
        if (ch === ')' || ch === ']' || ch === '}') {
          depth3--;
          current += ch;
          continue;
        }
        
        if (ch === ',' && depth3 === 0) {
          params.push(current.trim());
          current = '';
          continue;
        }
        
        current += ch;
      }
      
      if (current.trim()) {
        params.push(current.trim());
      }
      
      paramsArray = params;
    }
    
    // Now replace $1, $2, etc. in the SQL with ${param}
    let newSql = sqlContent;
    
    // We need to handle ::type casts that follow $N
    // $1::jsonb -> ${param}::jsonb
    // $1::text[] -> ${param}::text[]
    // $2::uuid[] -> ${param}::uuid[]
    
    // Find all $N references in order and replace them
    // Process from highest N to lowest to avoid index issues
    const paramRefs = [];
    const paramRegex = /\$(\d+)/g;
    let pm;
    while ((pm = paramRegex.exec(newSql)) !== null) {
      paramRefs.push({ index: parseInt(pm[1]), pos: pm.index, length: pm[0].length });
    }
    
    // Group by index and take the last occurrence (for safety)
    const paramMap = new Map();
    for (const ref of paramRefs) {
      paramMap.set(ref.index, ref);
    }
    
    // Replace from highest index to lowest
    const sortedRefs = [...paramMap.values()].sort((a, b) => b.pos - a.pos);
    
    for (const ref of sortedRefs) {
      const paramIdx = ref.index - 1;
      if (paramIdx < paramsArray.length) {
        const paramExpr = paramsArray[paramIdx];
        
        // Check for ::type cast after $N
        const after = newSql.substring(ref.pos + ref.length);
        let castMatch = after.match(/^::\w+(?:\[\])?/);
        
        let replacement;
        if (castMatch) {
          // Include the cast in the ${} expression
          // Actually, for Kysely we should NOT include the cast inside ${}
          // The cast should stay outside. So:
          // $1::jsonb -> ${paramExpr}::jsonb
          replacement = '${' + paramExpr + '}' + castMatch[0];
        } else {
          replacement = '${' + paramExpr + '}';
        }
        
        newSql = newSql.substring(0, ref.pos) + replacement + newSql.substring(ref.pos + ref.length + (castMatch ? castMatch[0].length : 0));
      }
    }
    
    // Build the replacement
    const replacement = `sql\`\n${newSql}\n\`.execute(db)`;
    
    // Replace in content
    content = content.substring(0, range.start) + replacement + content.substring(range.end + 1);
    convertedCount++;
  } else if (inner.startsWith("'") || inner.startsWith('"')) {
    // Simple string SQL (single quotes)
    let quote = inner[0];
    let strEnd = -1;
    for (let ci = 1; ci < inner.length; ci++) {
      if (inner[ci] === '\\') { ci++; continue; }
      if (inner[ci] === quote) { strEnd = ci; break; }
    }
    
    if (strEnd === -1) {
      skippedCount++;
      continue;
    }
    
    const sqlContent = inner.substring(1, strEnd);
    let afterSQL = inner.substring(strEnd + 1).trim();
    
    let paramsArray = [];
    if (afterSQL.startsWith(',')) {
      afterSQL = afterSQL.substring(1).trim();
    }
    
    if (afterSQL.startsWith('[')) {
      // Simplified parsing - just get the array content
      let depth2 = 1;
      let arrayContent = '';
      let ci = 1;
      
      while (ci < afterSQL.length && depth2 > 0) {
        const ch = afterSQL[ci];
        if (ch === '[' || ch === '{' || ch === '(') depth2++;
        else if (ch === ']' || ch === '}' || ch === ')') depth2--;
        if (depth2 > 0 || ch !== ']') arrayContent += ch;
        ci++;
      }
      
      const items = arrayContent.split(',').map(s => s.trim()).filter(Boolean);
      paramsArray = items;
    }
    
    let newSql = sqlContent;
    const paramRefs = [];
    const paramRegex = /\$(\d+)/g;
    let pm;
    while ((pm = paramRegex.exec(newSql)) !== null) {
      paramRefs.push({ index: parseInt(pm[1]), pos: pm.index, length: pm[0].length });
    }
    
    const sortedRefs = [...new Map(paramRefs.map(r => [r.index, r])).values()].sort((a, b) => b.pos - a.pos);
    
    for (const ref of sortedRefs) {
      const paramIdx = ref.index - 1;
      if (paramIdx < paramsArray.length) {
        const paramExpr = paramsArray[paramIdx];
        const after = newSql.substring(ref.pos + ref.length);
        let castMatch = after.match(/^::\w+(?:\[\])?/);
        let replacement = '${' + paramExpr + '}' + (castMatch ? castMatch[0] : '');
        newSql = newSql.substring(0, ref.pos) + replacement + newSql.substring(ref.pos + ref.length + (castMatch ? castMatch[0].length : 0));
      }
    }
    
    const replacement = `sql\`${newSql}\`.execute(db)`;
    content = content.substring(0, range.start) + replacement + content.substring(range.end + 1);
    convertedCount++;
  } else {
    // Complex case - might be a template literal with ${} or a variable
    // Skip this one
    skippedCount++;
  }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log(`Converted: ${convertedCount}, Skipped: ${skippedCount}`);

// Count remaining
const remaining = (content.match(/pool\.query\(/g) || []).length;
console.log(`Remaining pool.query() calls: ${remaining}`);
