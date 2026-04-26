#!/bin/bash
# ResiQ CRM — Hostinger VPS Deployment Script (Docker + Traefik)
# Run this on your VPS after cloning the repo

set -e

DOMAIN="${DOMAIN:-crm.resiq.co}"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           ResiQ CRM — Hostinger VPS Deployment              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Domain: $DOMAIN"
echo ""

# ─── .env check ───────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "⚠️  .env not found. Copying from .env.example..."
  cp .env.example .env
  echo "❌ Please fill in .env with your production values, then re-run."
  exit 1
fi

if grep -q "YOUR_DOMAIN\|change-this\|XXXXXXXXXX" .env; then
  echo "❌ .env still has placeholder values. Please update before deploying."
  exit 1
fi

# Set domain in .env if not already set
if ! grep -q "^DOMAIN=" .env; then
  echo "DOMAIN=$DOMAIN" >> .env
fi

echo "✅ .env configured"

# ─── Ensure Traefik network exists ────────────────────────────────────────────
docker network create traefik 2>/dev/null || echo "✅ Traefik network already exists"

# ─── Build and start ──────────────────────────────────────────────────────────
echo ""
echo "Building Docker image..."
docker compose -f docker-compose.prod.yml build --no-cache

echo ""
echo "Starting services..."
docker compose -f docker-compose.prod.yml up -d

# ─── Wait for health ──────────────────────────────────────────────────────────
echo ""
echo "Waiting for app to be healthy..."
attempt=0
until docker compose -f docker-compose.prod.yml exec -T app wget -qO- http://localhost:5000/api/webhooks/health &>/dev/null; do
  attempt=$((attempt+1))
  if [ $attempt -gt 24 ]; then
    echo "❌ App failed to start. Check logs: docker compose logs app"
    exit 1
  fi
  echo "  Waiting... ($attempt/24)"
  sleep 5
done

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                  Deployment Complete! 🎉                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  App URL:     https://$DOMAIN"
echo "  Health:      https://$DOMAIN/api/webhooks/health"
echo "  Logs:        docker compose -f docker-compose.prod.yml logs -f app"
echo ""
echo "Useful commands:"
echo "  docker compose -f docker-compose.prod.yml ps                  - Check all services"
echo "  docker compose -f docker-compose.prod.yml logs -f app         - Follow app logs"
echo "  docker compose -f docker-compose.prod.yml restart app         - Restart app only"
echo "  docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d  - Update to latest"
echo ""
