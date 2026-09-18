# syntax=docker/dockerfile:1

# ---- deps: full install (typecheck/lint/Tailwind need devDependencies) ----
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` runs the `postinstall` script, which is `prisma generate` --- so the
# schema and prisma.config.ts have to be in the image before the install, not
# just before the build. Without them the install dies with "Could not find
# Prisma Schema" and takes the whole container build with it.
COPY prisma.config.ts ./
COPY prisma ./prisma
# This build server's registry connection keeps dropping partway through the
# ~900-package install (ECONNRESET/ETIMEDOUT), even though raw throughput to
# the registry measures fine (33MB @ 10.9MB/s). The BuildKit cache mount is
# the key mitigation: tarballs already fetched persist in the build cache even
# when the step fails, so each retry resumes where the last left off instead
# of starting from zero — consecutive attempts get further until one completes.
# Do NOT `docker builder prune` between retries; that wipes this cache.
# The flags reduce concurrency and ride out slow responses.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --maxsockets=3 \
      --fetch-timeout=600000 \
      --fetch-retries=8 --fetch-retry-factor=2 \
      --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=180000

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
# Next 16 defaults `next build` to Turbopack; this project's validated
# production path is webpack (see the CI build step), so opt out explicitly.
# The bare `--` is npm passing the flag through to the `build` script.
RUN npm run build -- --webpack

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

# Belt-and-braces for sharp (used by the image-upload route). Next's file
# tracer is unreliable about pulling native modules into the standalone
# bundle — when it misses them, /api/uploads 500s at import time. Copy the
# installed sharp + its libvips binaries in explicitly. Must come *after* the
# standalone copy above, since that is what creates ./node_modules.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img

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
