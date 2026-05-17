#!/bin/bash
# resiq-lead-discovery.sh
# Searches Reddit for CRM leads and imports them into ResiQ CRM.
# Designed to be run weekly via cron.

set -e

REPO_DIR="/Users/siddonj/repo/resiq-crm"
NODE_BIN="/opt/homebrew/bin/node"
VPS_HOST="2.24.214.73"
VPS_USER="root"
VPS_PROJECT="/home/ubuntu/resiq-crm"
VPS_SSH_KEY="/Users/siddonj/.ssh/resiq_crm_vps"
USER_AGENT="ResiQ-CRM-Lead-Finder/1.0"

# Clean up any leftover temp files
rm -f /tmp/resiq-leads-*.json

echo "=== ResiQ Weekly Lead Discovery ==="
echo "Date: $(date '+%Y-%m-%d %H:%M')"
echo ""

SUBREDDITS=(
  "PropertyManagement:CRM+need+OR+recommend+OR+looking+for+OR+software"
  "RealEstateTechnology:CRM+need+OR+looking+for+OR+recommend+OR+help"
  "smallbusiness:CRM+recommendation+OR+looking+for+CRM+OR+need+a+CRM"
  "realtors:CRM+recommendation+OR+best+CRM+OR+looking+for+CRM"
  "CommercialRealEstate:CRM+software+OR+property+management+software+OR+need+CRM"
  "PropertyTech:software+OR+platform+OR+CRM+OR+management"
)

TEMP_FILE=$(mktemp /tmp/resiq-leads-XXXXXX.json)
ALL_LEADS_FILE=$(mktemp /tmp/resiq-leads-all-XXXXXX.json)
echo '[]' > "$ALL_LEADS_FILE"

TOTAL_FOUND=0

for entry in "${SUBREDDITS[@]}"; do
  SUB="${entry%%:*}"
  KW="${entry#*:}"
  
  echo "📡 Searching r/$SUB..."
  
  # Fetch from Reddit
  RESULTS=$(curl -s -A "$USER_AGENT" \
    "https://www.reddit.com/r/${SUB}/search.json?q=${KW}&restrict_sr=1&sort=new&limit=15" 2>&1)
  
  # Check if valid JSON
  POST_COUNT=$(echo "$RESULTS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',{}).get('children',[])))" 2>/dev/null || echo "0")
  
  if [ "$POST_COUNT" = "0" ]; then
    echo "  → No posts found"
    continue
  fi
  
  echo "  → Found $POST_COUNT posts"
  
  # Parse leads
  echo "$RESULTS" | $NODE_BIN "$REPO_DIR/scripts/discover-leads.js" 2>/dev/null > "$TEMP_FILE"
  
  LEAD_COUNT=$(python3 -c "import json; print(len(json.load(open('$TEMP_FILE'))))" 2>/dev/null || echo "0")
  
  if [ "$LEAD_COUNT" -gt 0 ]; then
    echo "  → $LEAD_COUNT qualified leads"
    TOTAL_FOUND=$((TOTAL_FOUND + LEAD_COUNT))
    
    # Merge with all leads
    python3 -c "
import json
all_leads = json.load(open('$ALL_LEADS_FILE'))
new_leads = json.load(open('$TEMP_FILE'))
all_leads.extend(new_leads)
json.dump(all_leads, open('$ALL_LEADS_FILE', 'w'))
" 2>/dev/null
  fi
done

echo ""
echo "=== Total qualified leads found: $TOTAL_FOUND ==="

if [ "$TOTAL_FOUND" -eq 0 ]; then
  echo "No leads to import."
  rm -f "$TEMP_FILE" "$ALL_LEADS_FILE"
  exit 0
fi

# Copy to VPS
echo ""
echo "📤 Transferring leads to VPS..."
scp -q -i "$VPS_SSH_KEY" "$ALL_LEADS_FILE" "${VPS_USER}@${VPS_HOST}:${VPS_PROJECT}/scripts/discovered-leads.json"

# Import into CRM
echo "📥 Importing into CRM..."
ssh -i "$VPS_SSH_KEY" "${VPS_USER}@${VPS_HOST}" \
  "docker cp ${VPS_PROJECT}/scripts/discovered-leads.json resiq-app:/app/scripts/discovered-leads.json && \
   docker exec -e NODE_PATH=/app/server/node_modules resiq-app node /app/scripts/import-leads.js /app/scripts/discovered-leads.json" 2>&1 | grep -E "^  (✅|⏭️|❌|📊)"

# Cleanup
rm -f "$TEMP_FILE" "$ALL_LEADS_FILE"
echo ""
echo "✅ Discovery complete!"
