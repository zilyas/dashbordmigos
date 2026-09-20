# ---- deps: full install (typecheck/lint/Tailwind need devDependencies) ----
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` runs the `postinstall` script, which is `prisma generate` --- so the
# schema and prisma.config.ts have to be in the image before the install, not
# just before the build. Without them the install dies with "Could not find
# Prisma Schema" and takes the whole container build with it.
# Only the schema, not the whole prisma/ directory: `generate` never reads
# migrations or seed.ts, and copying them here would bust this ~1000-package
# install layer on every migration commit.
COPY prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
# This build server's registry connection keeps dropping partway through the
# ~900-package install (ECONNRESET/ETIMEDOUT), even though raw throughput to
# the registry measures fine (33MB @ 10.9MB/s). The BuildKit cache mount is
# the key mitigation: tarballs already fetched persist in the build cache even
# when the step fails, so each retry resumes where the last left off instead
# of starting from zero — consecutive attempts get further until one completes.
# Do NOT `docker builder prune` between retries; that wipes this cache.
#
# npm's own --fetch-retries only covers a request that fails outright; a socket
# reset part-way through a tarball read still aborts the whole install (deploy
# 2026-09-18 13:14 died on ECONNRESET after 318s). So the install is wrapped in
# its own retry loop: each pass re-uses everything the previous one got into
# the cache mount, so attempts get progressively further instead of restarting
# from zero. --prefer-offline keeps it from re-validating what it already has.
RUN --mount=type=cache,target=/root/.npm \
    for attempt in 1 2 3 4 5; do \
      npm ci --no-audit --no-fund --prefer-offline --maxsockets=8 \
        --fetch-timeout=600000 \
        --fetch-retries=8 --fetch-retry-factor=2 \
        --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=180000 \
      && exit 0; \
      echo "npm ci attempt $attempt failed; the cache is warmer, retrying in 15s"; \
      sleep 15; \
    done; \
    echo "npm ci failed 5 times --- the registry connection is down, not slow"; \
    exit 1

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
# next.config.ts reads this at config-resolution time to build BOTH the CSP
# img-src origin and images.remotePatterns, and standalone bakes the resolved
# config into .next/standalone/server.js — it is never re-read at runtime (see
# __NEXT_PRIVATE_STANDALONE_CONFIG in next/dist/server/config.js). Setting it
# only as a Coolify runtime var therefore ships an image whose optimizer
# rejects every R2 URL with 400 "url parameter is not allowed", while the CSP
# blocks the unoptimised fallback. It must ALSO stay set at runtime, where
# src/lib/storage/r2.ts uses it to build each object's public URL.
# Not a secret: this is the public bucket base URL, not a credential.
ARG R2_PUBLIC_BASE_URL=""
ENV R2_PUBLIC_BASE_URL=${R2_PUBLIC_BASE_URL}

RUN npx prisma generate
# Next 16 defaults `next build` to Turbopack; this project's validated
# production path is webpack (see the CI build step), so opt out explicitly.
# The bare `--` is npm passing the flag through to the `build` script.
RUN --mount=type=cache,target=/app/.next/cache npm run build -- --webpack

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

# Coolify's health check command must be, exactly:
#
#   wget -q -O /dev/null http://127.0.0.1:3000/api/health
#
# 127.0.0.1, not localhost. HOSTNAME=0.0.0.0 above makes Next listen on IPv4
# only, while Alpine resolves localhost to ::1 first; busybox wget tries the
# IPv6 address, gets ECONNREFUSED and gives up without falling back. That is
# what the 2026-09-18 14:42 deploy hit — "wget: can't connect to remote host:
# Connection refused" on a container whose own log said "Ready in 0ms". The CI
# smoke test hit the identical trap (see .github/workflows/ci.yml).
#
# /api/health, not / — see src/app/api/health/route.ts. `/` redirects to the
# login page via the Proxy matcher in src/proxy.ts. Note /api/health returns
# 503 while Postgres is unreachable, which is correct but will fail the rolling
# update; point the check at /login if the database is not wired up yet.
#
# No HEALTHCHECK instruction here on purpose: Coolify writes its own into the
# generated compose file, and one in the image would be silently overridden.
#
# `node server.js` runs as PID 1, so it receives SIGTERM directly and Next
# drains in-flight requests on its own — no init/signal-forwarding wrapper.
CMD ["node", "server.js"]
