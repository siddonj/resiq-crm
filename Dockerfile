# Multi-stage build for ResiQ CRM
# Stage 1: Build dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/

# Install dependencies
RUN npm ci && \
    npm ci --prefix server && \
    npm ci --prefix client

# Copy application code
COPY . .

# Build client (static assets)
RUN npm run build --prefix client

# Stage 2: Production runtime
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/

RUN npm ci --only=production && \
    npm ci --only=production --prefix server

# Copy server code from builder
COPY server/src ./server/src

# Copy built client from builder
COPY --from=builder /app/client/dist ./client/dist

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD npm run healthcheck || exit 1

# Start server
CMD ["npm", "start", "--prefix", "server"]
