#!/bin/bash
# ResiQ CRM — VPS Deployment Script
# Run this on your VPS after cloning the repo

set -e

DOMAIN="${DOMAIN:-YOUR_DOMAIN.com}"
EMAIL="${EMAIL:-admin@YOUR_DOMAIN.com}"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           ResiQ CRM — Production Deployment                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Prerequisites ────────────────────────────────────────────────────────────
check_command() {
  if ! command -v "$1" &>/dev/null; then
    echo "❌ $1 not found. Please install it first."
    exit 1
  fi
}

echo "Checking prerequisites..."
check_command docker
check_command docker-compose || check_command "docker compose"
echo "✅ Prerequisites OK"
echo ""

# ─── .env check ───────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "⚠️  .env not found. Copying from .env.example..."
  cp .env.example .env
  echo "❌ Please fill in .env with your production values, then re-run this script."
  exit 1
fi

if grep -q "YOUR_DOMAIN\|change-this\|XXXXXXXXXX" .env; then
  echo "❌ .env still has placeholder values. Please update before deploying."
  echo "   Look for: YOUR_DOMAIN, change-this, XXXXXXXXXX"
  exit 1
fi

echo "✅ .env configured"

# ─── Update Nginx domain ──────────────────────────────────────────────────────
echo "Configuring Nginx for domain: $DOMAIN..."
sed -i "s/YOUR_DOMAIN.com/$DOMAIN/g" nginx/conf.d/resiq.conf
echo "✅ Nginx configured"

# ─── Build and start services ─────────────────────────────────────────────────
echo ""
echo "Building Docker images..."
docker compose build --no-cache

echo ""
echo "Starting services (HTTP only first for SSL cert)..."
# Start without SSL for initial certbot challenge
docker compose up -d postgres redis nginx

echo ""
echo "Obtaining SSL certificate..."
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" || echo "⚠️  Certbot failed — check domain DNS and try again"

echo ""
echo "Starting full application..."
docker compose up -d

# ─── Wait for health ──────────────────────────────────────────────────────────
echo ""
echo "Waiting for app to be healthy..."
attempt=0
until docker compose exec -T app wget -qO- http://localhost:5000/api/webhooks/health &>/dev/null; do
  attempt=$((attempt+1))
  if [ $attempt -gt 20 ]; then
    echo "❌ App failed to start. Check logs: docker compose logs app"
    exit 1
  fi
  echo "  Waiting... ($attempt/20)"
  sleep 5
done

echo "✅ App is running and healthy!"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                  Deployment Complete! 🎉                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  App URL:     https://$DOMAIN"
echo "  Health:      https://$DOMAIN/api/webhooks/health"
echo "  Logs:        docker compose logs -f app"
echo "  DB Backup:   docker compose exec postgres pg_dump -U resiq resiq_crm"
echo ""
echo "Useful commands:"
echo "  docker compose ps                  - Check all services"
echo "  docker compose logs -f app         - Follow app logs"
echo "  docker compose restart app         - Restart app"
echo "  docker compose down && docker compose up -d  - Full restart"
echo ""
