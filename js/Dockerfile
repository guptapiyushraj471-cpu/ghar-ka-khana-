# Use an LTS Node runtime
FROM node:18-alpine

# Set env early for slimmer installs
ENV NODE_ENV=production
ENV PORT=8080

# Create app dir + persistent data dir
WORKDIR /app
RUN mkdir -p /app/data && chown -R node:node /app

# Install curl for HEALTHCHECK (tiny)
RUN apk add --no-cache curl

# Install dependencies with caching
COPY package.json package-lock.json* ./
# Prefer npm ci when lockfile exists; fallback to install
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --only=production; fi

# Copy source
COPY . .

# Ensure runtime user is non-root
USER node

# Expose application port
EXPOSE 8080

# Persist orders/menu if you write to ./data at runtime
VOLUME ["/app/data"]

# Simple healthcheck (server has /api/health)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://localhost:${PORT}/api/health || exit 1

# Start the server
CMD ["node", "server.js"]
