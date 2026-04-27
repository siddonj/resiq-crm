# Production Readiness Checklist

Use this checklist before each production release.

## Code and Branch

- [ ] `main` contains intended commits only
- [ ] `git status` is clean
- [ ] release notes/changelog updated (if used)

## Build and Verification

- [ ] `npm run migrate` passes locally
- [ ] `npm run test:outbound-smoke` passes
- [ ] `npm run build --prefix client` passes

## Environment and Secrets

- [ ] `.env` has no placeholder values
- [ ] `JWT_SECRET` is strong and unique
- [ ] `ENCRYPTION_KEY` is exactly 32 bytes
- [ ] `ALLOW_SYNTHETIC_LEADS=false`
- [ ] `OUTBOUND_DAILY_EMAIL_SEND_LIMIT` set
- [ ] `OUTBOUND_DAILY_LINKEDIN_SEND_LIMIT` set
- [ ] required integration credentials configured (`SMTP`, `TWILIO`, `STRIPE`, `GOOGLE/GMAIL`)

## Database and Backups

- [ ] backup taken before deploy
- [ ] latest migrations reviewed (`database/migrations`)
- [ ] rollback plan validated

## Deploy

- [ ] `docker compose -f docker-compose.prod.yml build app --no-cache`
- [ ] `docker compose -f docker-compose.prod.yml up -d`
- [ ] `docker compose -f docker-compose.prod.yml ps` healthy

## Post-Deploy Validation

- [ ] `GET /api/health` returns 200
- [ ] `GET /api/webhooks/health` returns 200
- [ ] login works
- [ ] `/outbound-automation` loads
- [ ] create campaign, approve draft, send/complete works
- [ ] suppression blocks are enforced
- [ ] export endpoints return CSV:
  - [ ] `/api/outbound/events/export?format=csv`
  - [ ] `/api/outbound/audit/export?format=csv`

## Monitoring

- [ ] app logs clean of startup errors
- [ ] postgres/redis healthy
- [ ] uptime checks configured
- [ ] daily backup job configured
