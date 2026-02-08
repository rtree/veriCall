# Use Node.js LTS
FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Git commit SHA for source code attestation (passed via --build-arg)
ARG SOURCE_CODE_COMMIT=unknown
ENV SOURCE_CODE_COMMIT=$SOURCE_CODE_COMMIT

# Build Next.js
RUN pnpm build

# Production image - use full node_modules for custom server
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Carry forward the commit SHA into runtime
ARG SOURCE_CODE_COMMIT=unknown
ENV SOURCE_CODE_COMMIT=$SOURCE_CODE_COMMIT

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy all necessary files for custom server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./

USER nextjs

EXPOSE 8080

ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Use tsx to run TypeScript server directly
CMD ["npx", "tsx", "server.ts"]
