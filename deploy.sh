#!/bin/bash
# ResiQ CRM - Hostinger VPS Deployment Script (Docker + Nginx Proxy Manager)
# Run this on your VPS after cloning the repo.

set -e

DOMAIN="${DOMAIN:-crm.resiq.co}"
COMPOSE_FILE="docker-compose.prod.yml"

echo "============================================================"
echo "ResiQ CRM - Hostinger VPS Deployment"
echo "============================================================"
echo ""
echo "Domain: $DOMAIN"
echo ""

# .env check
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copying from .env.example..."
  cp .env.example .env
  echo "Please fill in .env with production values, then rerun."
  exit 1
fi

if grep -q "YOUR_DOMAIN\|change-this\|XXXXXXXXXX" .env; then
  echo "ERROR: .env still has placeholder values. Update it before deploying."
  exit 1
fi

# Set DOMAIN in .env if missing
if ! grep -q "^DOMAIN=" .env; then
  echo "DOMAIN=$DOMAIN" >> .env
fi

echo "OK: .env is configured"

# Ensure shared network for Nginx Proxy Manager exists
docker network create npm_proxy 2>/dev/null || echo "OK: npm_proxy network already exists"

echo ""
echo "Building Docker images..."
docker compose -f "$COMPOSE_FILE" build --no-cache

echo ""
echo "Starting services..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "Waiting for app health..."
attempt=0
until docker compose -f "$COMPOSE_FILE" exec -T app wget -qO- http://localhost:5000/api/webhooks/health >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 24 ]; then
    echo "ERROR: App failed to start. Check logs with:"
    echo "  docker compose -f $COMPOSE_FILE logs app"
    exit 1
  fi
  echo "  waiting... ($attempt/24)"
  sleep 5
done

echo ""
echo "============================================================"
echo "Deployment complete"
echo "============================================================"
echo ""
echo "App URL: https://$DOMAIN"
echo "Health:  https://$DOMAIN/api/webhooks/health"
echo "Logs:    docker compose -f $COMPOSE_FILE logs -f app"
echo ""
echo "Useful commands:"
echo "  docker compose -f $COMPOSE_FILE ps"
echo "  docker compose -f $COMPOSE_FILE logs -f app"
echo "  docker compose -f $COMPOSE_FILE restart app"
echo "  docker compose -f $COMPOSE_FILE pull && docker compose -f $COMPOSE_FILE up -d"
echo ""
