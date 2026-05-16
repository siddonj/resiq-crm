#!/usr/bin/env bash
# Import local issue files to GitHub Issues
# Usage: ./scripts/import-issues.sh [--dry-run]
# Prerequisites: gh CLI authenticated (gh auth login)
# Run from repo root

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "🔍 DRY RUN — nothing will be created"
fi

ISSUES_DIR=".github/ISSUES"
MILESTONE="ResiQ-CRM Improvement Roadmap"

# Create milestone first
if ! $DRY_RUN; then
  echo "📦 Creating milestone: $MILESTONE"
  # GitHub CLI doesn't have milestone create directly, using API
  # Will be created when first issue is created with milestone
fi

for file in "$ISSUES_DIR"/*.md; do
  [ -f "$file" ] || continue
  
  echo ""
  echo "═══ $(basename "$file") ═══"
  
  # Extract title (first # heading)
  TITLE=$(grep -m1 '^# ' "$file" | sed 's/^# //')
  
  # Extract labels (comma-separated from YAML frontmatter)
  LABELS=$(grep '^**Labels:**' "$file" | sed 's/\*\*Labels:\*\* //')
  
  # Extract milestone
  ISSUE_MILESTONE=$(grep '^**Milestone:**' "$file" | sed 's/\*\*Milestone:\*\* //')
  
  # Extract body (everything after frontmatter)
  # Remove the first line (title), labels line, milestone line, estimate line
  BODY=$(sed '1,/^## Description$/d' "$file")
  
  echo "  📝 Title: $TITLE"
  echo "  🏷️  Labels: $LABELS"
  echo "  📎 Milestone: $ISSUE_MILESTONE"
  
  if ! $DRY_RUN; then
    LABEL_ARGS=""
    IFS=',' read -ra ADDR <<< "$LABELS"
    for label in "${ADDR[@]}"; do
      label=$(echo "$label" | xargs)  # trim whitespace
      LABEL_ARGS="$LABEL_ARGS --label \"$label\""
    done
    
    # Build command
    CMD="gh issue create \\
      --title \"$TITLE\" \\
      --body \"$BODY\" \\
      $LABEL_ARGS"
    
    echo "  🚀 Creating..."
    eval "$CMD"
  fi
done

echo ""
echo "✅ Done!"
if $DRY_RUN; then
  echo ""
  echo "To import for real:"
  echo "  1. gh auth login"
  echo "  2. ./scripts/import-issues.sh"
fi
