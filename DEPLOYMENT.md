# ResiQ CRM Deployment Runbook

This is the production deployment guide for the current codebase, including outbound automation and campaigns.

## 1. Production Topology

Recommended:

- Docker Compose stack on VPS
- `app` container (Node API + built client assets)
- `postgres` container
- `redis` container
- Nginx Proxy Manager for TLS + routing

Primary files:

- `docker-compose.prod.yml`
- `deploy.sh`
- `HOSTINGER_NGINX_PROXY_MANAGER_SETUP.md`

## 2. Pre-Deploy Checklist

Before pushing to production:

1. Branch is up to date with `main`.
2. Local migration run succeeds:
   - `npm run migrate`
3. Outbound smoke test passes:
   - `npm run test:outbound-smoke`
4. Client build succeeds:
   - `npm run build --prefix client`
5. `.env` production values are ready (no placeholders).

## 3. Required Environment Variables

At minimum:

```env
NODE_ENV=production
PORT=5000
DOMAIN=your.domain.com

POSTGRES_USER=resiq
POSTGRES_PASSWORD=strong-password
POSTGRES_DB=resiq_crm

JWT_SECRET=replace-with-random-64-char-secret
ENCRYPTION_KEY=exactly-32-byte-value-here-1234

API_URL=https://your.domain.com
CLIENT_PORTAL_URL=https://your.domain.com

ALLOW_SYNTHETIC_LEADS=false
OUTBOUND_DAILY_EMAIL_SEND_LIMIT=40
OUTBOUND_DAILY_LINKEDIN_SEND_LIMIT=50
```

Also configure integration credentials as needed:

- `SMTP_*`
- `TWILIO_*`
- `STRIPE_*`
- `GMAIL_*` / `GOOGLE_*`
- `REDIS_PASSWORD` if used

## 4. First Deployment

On server:

```bash
git clone https://github.com/siddonj/resiq-crm.git
cd resiq-crm
cp .env.example .env
# edit .env with production values
chmod +x deploy.sh
./deploy.sh
```

What the script does:

- validates `.env`
- ensures `nginx_proxy_manager_default` network exists
- builds image with `docker-compose.prod.yml`
- starts services
- waits for app health response

## 5. Health Verification

After deploy:

```bash
docker compose -f docker-compose.prod.yml ps
curl -f https://your.domain.com/api/health
curl -f https://your.domain.com/api/webhooks/health
```

Optional outbound checks:

- log in and open `/outbound-automation`
- create campaign
- generate/approve/send draft

## 6. Update Deployment

```bash
git pull origin main
docker compose -f docker-compose.prod.yml build app --no-cache
docker compose -f docker-compose.prod.yml up -d app
```

## 7. Backups and Rollback

Backup:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U resiq resiq_crm > backup_$(date +%Y%m%d_%H%M%S).sql
```

Rollback app image:

1. checkout previous commit/tag
2. rebuild app container
3. restart app

Database rollback:

- restore from backup when schema/data rollback is required

## 8. Post-Deploy Monitoring

Useful commands:

```bash
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f redis
docker stats
```

Watch for:

- migration errors
- auth/token errors
- queue/redis connectivity warnings
- outbound limit and suppression enforcement behavior

## 9. Production Hardening Notes

- Keep synthetic lead generation disabled (`ALLOW_SYNTHETIC_LEADS=false`).
- Rotate secrets regularly (`JWT_SECRET`, integration keys).
- Restrict CORS to known frontend origins.
- Schedule daily PostgreSQL backups.
- Add uptime checks for both `/api/health` and `/api/webhooks/health`.
- Ensure Nginx Proxy Manager has WebSocket support enabled for `/ws/tickets`.
