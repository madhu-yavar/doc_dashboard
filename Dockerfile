# Multi-stage build for Doctor Dashboard

# Stage 1: Build the React frontend
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Build the frontend
RUN npm run build

# Stage 2: Production image with Node.js backend
FROM node:22-alpine

WORKDIR /app

# Install runtime dependencies
# dumb-init: proper signal handling
# poppler-utils: pdftoppm for PDF to image conversion (classification, masking)
# Playwright/Chromium dependencies for prescription PDF generation
RUN apk add --no-cache dumb-init poppler-utils \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./
COPY bun.lock* ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm install playwright@^1.57.0 && \
    npx playwright install --with-deps chromium && \
    npm cache clean --force

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/index.html ./

# Copy server, agents, skills, tools, config directories
COPY server ./server
COPY agents ./agents
COPY skills ./skills
COPY tools ./tools
COPY config ./config
COPY scripts ./scripts
COPY prescription_template_dev ./prescription_template_dev

# Create necessary directories with proper permissions
RUN mkdir -p server/storage/uploads server/storage/prescriptions && \
    ls -la prescription_template_dev && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the port
EXPOSE 8001

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=8001
ENV GEMMA_URL=http://206.1.62.28:8000/v1/chat/completions
ENV GEMMA_MODEL=google/gemma-4-26B-A4B-it

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8001/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start both Vite preview server and Express backend
CMD ["node", "-e", "\
    const { spawn } = require('child_process');\
    const express = spawn('node', ['server/index.cjs'], { stdio: 'inherit' });\
    express.on('exit', (code) => process.exit(code));\
"]
