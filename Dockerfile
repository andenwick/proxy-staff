# =============================================================================
# Stage 1: Builder
# Installs all dependencies, compiles TypeScript, generates Prisma client
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies needed for native modules
RUN apk add --no-cache python3 make g++

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy Prisma schema, config, and generate client
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npx prisma generate

# Copy TypeScript configuration and source code
COPY tsconfig.json ./
COPY src ./src/

# Compile TypeScript to JavaScript
RUN npm run build

# =============================================================================
# Stage 2: Production
# Minimal image with only production runtime requirements
#
# NOTE: Image size with Chromium is ~1.8GB due to browser dependencies.
# The 500MB target is not achievable with full browser automation support.
# If browser automation is not needed, remove chromium-related packages
# to reduce image size to ~200MB.
# =============================================================================
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies:
# - bash for Claude CLI (required for spawning MCP servers and shell commands)
# - Python 3 for tenant Python tools execution
# - Chromium and minimal dependencies for Playwright browser automation
# - dumb-init for proper signal handling
# - su-exec for dropping privileges after fixing volume permissions
RUN apk add --no-cache \
    bash \
    python3 \
    py3-pip \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    dumb-init \
    su-exec \
    && pip3 install --no-cache-dir --break-system-packages requests \
    && rm -rf /var/cache/apk/* /tmp/*

# Set Playwright to use system Chromium instead of downloading browsers
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies and clean npm cache
RUN npm ci --omit=dev && \
    npm cache clean --force && \
    rm -rf /tmp/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Copy Prisma schema, config, and generated client from builder
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma/
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma/

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist/

# Copy static assets (templates and Python tools) - not compiled by TypeScript
COPY --from=builder /app/src/templates ./src/templates/
COPY --from=builder /app/src/tools/python ./src/tools/python/

# Copy tenant folders to a backup location (volume mount will hide /app/tenants)
# These will be copied to the volume at startup if they don't exist
COPY tenants ./tenant-seeds/

# Create directory for tenant folders (will be mounted as volume in production)
RUN mkdir -p /app/tenants && chown nodejs:nodejs /app/tenants

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose application port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Fix volume permissions as root, seed tenant folders, then drop to nodejs user for app
# Claude CLI requires non-root user when using --dangerously-skip-permissions
# Tenant seeding: copies static files from /app/tenant-seeds/ to /app/tenants/
# - execution/ (tools) and directives/ (SOPs) are always synced from seeds
# - life/, state/, history/ are preserved (user data)
CMD ["sh", "-c", "\
  chown -R nodejs:nodejs /app/tenants 2>/dev/null; \
  for tenant in /app/tenant-seeds/*/; do \
    name=$(basename $tenant); \
    dest=/app/tenants/$name; \
    mkdir -p $dest; \
    echo \"Syncing tenant: $name\"; \
    cp -f $tenant/CLAUDE.md $dest/ 2>/dev/null || true; \
    cp -rf $tenant/execution $dest/ 2>/dev/null || true; \
    cp -rf $tenant/operations $dest/ 2>/dev/null || true; \
    cp -rf $tenant/identity $dest/ 2>/dev/null || true; \
    cp -rf $tenant/knowledge $dest/ 2>/dev/null || true; \
    cp -rf $tenant/shared_tools $dest/ 2>/dev/null || true; \
    cp -rf $tenant/directives $dest/ 2>/dev/null || true; \
    chown -R nodejs:nodejs $dest; \
  done; \
  exec su-exec nodejs sh -c 'npx prisma migrate deploy && node dist/index.js'"]
