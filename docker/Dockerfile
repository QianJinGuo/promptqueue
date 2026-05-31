# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app

# Copy dependency manifests for all workspace packages
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/cli/package.json packages/cli/package.json

# Install all dependencies (frozen lockfile ensures reproducible builds)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json turbo.json ./
COPY packages/core ./packages/core
COPY packages/server ./packages/server
COPY packages/cli ./packages/cli

# Build all packages (turbo orchestrates the workspace build)
RUN pnpm build

# Stage 3: Runtime
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy production node_modules (preserves pnpm workspace symlinks)
COPY --from=deps /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 appuser && \
  chown -R appuser:nodejs /app

USER appuser

EXPOSE 8080
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Single image serving API + worker + dashboard
CMD ["node", "packages/server/dist/index.js"]
