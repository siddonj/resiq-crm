# Multi-stage build for ResiQ CRM
# Stage 1: Build client static assets
FROM node:20-alpine AS client-builder

WORKDIR /app/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# Stage 2: Build server dependencies
FROM node:20-alpine AS server-builder

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --only=production

# Stage 3: Production runtime
FROM node:20-alpine

# Install wget for healthcheck
RUN apk add --no-cache wget

WORKDIR /app

# Copy production server dependencies
COPY --from=server-builder /app/server/node_modules ./server/node_modules

# Copy server source
COPY server/package.json ./server/
COPY server/src ./server/src

# Copy built client from client-builder
COPY --from=client-builder /app/client/dist ./client/dist

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/webhooks/health || exit 1

# Start server
CMD ["node", "server/src/index.js"]
