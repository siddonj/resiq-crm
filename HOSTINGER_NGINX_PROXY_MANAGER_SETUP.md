# ResiQ CRM Setup on Hostinger VPS with Nginx Proxy Manager

This runbook deploys ResiQ CRM on a Hostinger VPS using Docker Compose, with Nginx Proxy Manager (NPM) handling public HTTPS access.

This guide assumes NPM is running in Docker on the same VPS.

## 1. Architecture

- `resiq-app` (Node API + built React app) runs in Docker
- `resiq-postgres` runs in Docker
- `resiq-redis` runs in Docker
- Nginx Proxy Manager terminates TLS and routes traffic to `resiq-app:5000`

## 2. Prerequisites

- Hostinger VPS with Ubuntu
- DNS `A` record pointing your domain/subdomain to the VPS IP
- Docker + Docker Compose plugin installed
- Nginx Proxy Manager already running

Recommended DNS target:

- `crm.yourdomain.com` -> `YOUR_VPS_IP`

## 3. Open Required Ports

Allow inbound:

- `22` (SSH)
- `80` (HTTP challenge + redirect)
- `81` (NPM admin UI, lock down by IP if possible)
- `443` (HTTPS)

If using UFW:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 81/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## 4. Prepare Application on VPS

```bash
git clone https://github.com/siddonj/resiq-crm.git
cd resiq-crm
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
NODE_ENV=production
PORT=5000
DOMAIN=crm.yourdomain.com

POSTGRES_USER=resiq
POSTGRES_PASSWORD=strong-db-password
POSTGRES_DB=resiq_crm

REDIS_PASSWORD=strong-redis-password

JWT_SECRET=replace-with-random-64-char-secret
ENCRYPTION_KEY=replace-with-exactly-32-bytes-key

API_URL=https://crm.yourdomain.com
CLIENT_PORTAL_URL=https://crm.yourdomain.com

ALLOW_SYNTHETIC_LEADS=false
OUTBOUND_DAILY_EMAIL_SEND_LIMIT=40
OUTBOUND_DAILY_LINKEDIN_SEND_LIMIT=50
```

Notes:

- `ENCRYPTION_KEY` must be exactly 32 bytes.
- Keep `ALLOW_SYNTHETIC_LEADS=false` in production.

## 5. Create Shared Docker Network for NPM

Create the external network used by both stacks:

```bash
docker network create npm_proxy
```

If it already exists, Docker will return an "already exists" message.

## 6. Connect NPM Container to `npm_proxy`

Find your NPM container name:

```bash
docker ps --format "table {{.Names}}\t{{.Image}}"
```

Connect it to the shared network:

```bash
docker network connect npm_proxy <npm_container_name>
```

Example:

```bash
docker network connect npm_proxy nginx-proxy-manager
```

## 7. Deploy ResiQ CRM Stack

Use the Hostinger/NPM compose file:

```bash
docker compose -f docker-compose.hostinger-npm.yml up -d --build
```

Check status:

```bash
docker compose -f docker-compose.hostinger-npm.yml ps
docker compose -f docker-compose.hostinger-npm.yml logs -f app
```

Health from inside the app container:

```bash
docker compose -f docker-compose.hostinger-npm.yml exec -T app wget -qO- http://localhost:5000/api/health
```

## 8. Configure Proxy Host in NPM

In NPM admin UI (usually `http://YOUR_VPS_IP:81`), create a Proxy Host:

- Domain Names: `crm.yourdomain.com`
- Scheme: `http`
- Forward Hostname / IP: `resiq-app`
- Forward Port: `5000`
- Websockets Support: `on` (required for `/ws/tickets`)
- Block Common Exploits: `on`

In SSL tab:

- Request a new SSL Certificate (Let's Encrypt)
- Force SSL: `on`
- HTTP/2 Support: `on`
- HSTS: optional

## 9. Verify Production Access

From your machine:

```bash
curl -f https://crm.yourdomain.com/api/health
curl -f https://crm.yourdomain.com/api/webhooks/health
```

In browser:

- `https://crm.yourdomain.com`
- `https://crm.yourdomain.com/outbound-automation`

## 10. Update Workflow

```bash
cd resiq-crm
git pull origin main
docker compose -f docker-compose.hostinger-npm.yml up -d --build app
```

## 11. Backup and Restore

Backup Postgres:

```bash
docker compose -f docker-compose.hostinger-npm.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup_$(date +%Y%m%d_%H%M%S).sql
```

Restore:

```bash
cat backup_file.sql | docker compose -f docker-compose.hostinger-npm.yml exec -T postgres \
  psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## 12. Troubleshooting

- 502 in NPM:
  - confirm `resiq-app` is healthy and on `npm_proxy` network
  - confirm NPM container is also on `npm_proxy`
- TLS certificate fails:
  - confirm DNS `A` record points to VPS
  - confirm ports `80/443` are open
- Login/session issues:
  - confirm `API_URL` and `CLIENT_PORTAL_URL` match your public domain
- Redis warnings in logs:
  - confirm `resiq-redis` is healthy

## 13. Optional: If NPM Is Not Running in Docker

If NPM is installed directly on the host, map app port to localhost and proxy to `127.0.0.1:5000`:

```yaml
services:
  app:
    ports:
      - "127.0.0.1:5000:5000"
```

Then set NPM forward target to:

- Hostname/IP: `127.0.0.1`
- Port: `5000`
