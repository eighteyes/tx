# Multi-stage build for TX Watch
# Stage 1: Builder
FROM node:18-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Stage 2: Runtime
FROM node:18-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    tmux \
    bash \
    curl \
    git \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S txwatch && \
    adduser -u 1001 -S txwatch -G txwatch

WORKDIR /app

# Copy application files
COPY --from=builder /build/node_modules ./node_modules
COPY package*.json ./
COPY tx.js ./
COPY attach.sh ./
COPY lib ./lib
COPY meshes ./meshes
COPY scripts ./scripts
COPY LICENSE ./
COPY README.md ./

# Set ownership
RUN chown -R txwatch:txwatch /app

# Create data directory
RUN mkdir -p /data && chown -R txwatch:txwatch /data

# Switch to non-root user
USER txwatch

# Set data directory as volume
VOLUME ["/data"]

# Create symlink for data directory
RUN ln -s /data /app/.ai

# Expose metrics port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Default to mock mode for container
ENV MOCK_MODE=true
ENV DEBUG=false
ENV NODE_ENV=production
ENV METRICS_PORT=3001

# Entry point script
COPY --chown=txwatch:txwatch docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["start"]