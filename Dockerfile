# syntax=docker/dockerfile:1

# ---- deps: full install (typecheck/lint/Tailwind need devDependencies) ----
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
# Registry-side robustness for constrained build servers: --no-audit/--no-fund
# skip the bulk POST that npm fires at the very end of install (the exact point
# where flaky builds kept resetting); --maxsockets caps parallel connections so
# a swarm of sockets can't overwhelm the host's connection tracking; retries +
# long timeouts ride out transient drops.
RUN npm ci --no-audit --no-fund --maxsockets=5 \
      --fetch-retries=5 --fetch-retry-factor=2 \
      --fetch-retry-mintimeout=15000 --fetch-retry-maxtimeout=120000

# ---- builder ----
FROM node:24-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# A syntactically valid connection string is enough for `next build` — the
# Prisma driver adapter is constructed at module load but never opens a
# connection until a request actually queries it, so no live DB is needed
# here. Coolify should still pass the real values as buildtime-available
# vars (see the deployment checklist) in case that ever changes.
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/db"
ENV DATABASE_URL=${DATABASE_URL}
ARG AUTH_SECRET="build-time-placeholder"
ENV AUTH_SECRET=${AUTH_SECRET}

RUN npx prisma generate
RUN npm run build

# ---- runner ----
FROM node:24-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# `output: "standalone"` only traces files each route actually imports —
# `public/` and `.next/static` are deliberately excluded from that trace and
# must be copied in manually.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Next's file tracer copies whatever already exists on disk at these paths
# at build time — on a dev machine that can include real uploaded images or
# backup files (password hashes, TOTP secrets). .dockerignore keeps them out
# of the build context, but this is cheap, explicit insurance against ever
# shipping local data in the image.
RUN rm -rf ./public/uploads ./storage \
  && mkdir -p public/uploads/products storage/backups \
  && chown -R nextjs:nodejs public/uploads storage

USER nextjs
EXPOSE 3000

# Coolify's health check should target /api/health (see
# src/app/api/health/route.ts). `node server.js` runs as PID 1 here, so it
# receives SIGTERM directly and Next drains in-flight requests on its own —
# no extra init/signal-forwarding wrapper needed.
CMD ["node", "server.js"]
