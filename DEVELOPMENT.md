# Development Guide

This guide explains how to set up the project on your machine. It covers
setup, the database, daily commands, feature flags, folder structure, and
debugging.

For product-level feature documentation (variants, units, batches, expiry
tracking, templates), see [README.md](./README.md). This guide focuses on
the developer workflow.

## 1. Prerequisites

- **Node.js 24.** The Dockerfile builds on `node:24-alpine`, and CI runs on
  Node 24 (`.github/workflows/ci.yml`). The repo has no `.nvmrc` and
  `package.json` sets no `engines` field, so nothing enforces this
  automatically. README.md states "Node.js 20+ (24 recommended)" — use 24 to
  match CI and production exactly.
- **npm.** The repo commits `package-lock.json` and CI runs `npm ci`. Use
  npm, not yarn or pnpm.
- **PostgreSQL.** Any Postgres works locally. Production uses Neon.
- **Docker** (optional). Only needed if you want to build or test the
  production container image locally.

## 2. Local setup

```bash
git clone <repo-url>
cd dashbordmigos
npm install
```

`npm install` runs `prisma generate` automatically (the `postinstall` script
in `package.json`). You do not need to run it by hand after a fresh clone.

Copy the environment template and fill in your own values:

```bash
cp .env.example .env
```

Do not open or copy the real `.env` file — it holds production secrets.
Read `.env.example` instead; every variable there has a comment that
explains its purpose and where to get a value. At minimum you need
`DATABASE_URL`, `DIRECT_URL`, and `AUTH_SECRET` to run the app. Everything
else (R2 image storage, Redis rate limiting, the expiry cron secret) is
optional and falls back to a local/in-memory default when left blank.

## 3. Database

### Schema and migrations

`prisma.config.ts` points migrations at `DIRECT_URL` (falls back to
`DATABASE_URL` if `DIRECT_URL` is unset) — migrations need an unpooled
connection.

```bash
npx prisma migrate dev --name <change>   # create and apply a migration locally
npx prisma migrate deploy                # apply pending migrations (production)
```

Use `migrate dev` locally: it also regenerates the Prisma client and keeps
the local `_prisma_migrations` shadow database in sync. Use `migrate deploy`
only in an already-provisioned environment (it never creates new migration
files).

### Seeding

```bash
npx prisma db seed
```

This runs `tsx prisma/seed.ts` (configured in `prisma.config.ts`). Reading
the script, it does two things, both idempotent (safe to re-run):

1. **Super Admin.** Creates one `SUPER_ADMIN` user
   (`SEED_SUPER_ADMIN_EMAIL`, default `superadmin@store.dev`). If a password
   isn't supplied via `SEED_SUPER_ADMIN_PASSWORD`, the script generates one
   and prints it once — save it immediately.
2. **Demo data** (skip with `SEED_DEMO=false`). Creates a `DEMO` store with
   a manager and seller login, sizes (`S/M/L/XL`), colors, a clothing
   category, and several products that exercise variants, decimal units,
   and category attributes together. Demo login passwords come from
   `SEED_DEMO_PASSWORD`, or are generated and printed once if unset.

## 4. Daily commands

```bash
npm run dev              # dev server (Turbopack)
npm run build            # production build (Turbopack)
npm start                # run a production build
npm test                 # run unit tests once (vitest)
npm run test:watch       # unit tests, watch mode
npm run lint             # eslint
npx tsc --noEmit         # typecheck (matches the CI step exactly)
```

### The `--webpack` flag

Next.js 16 defaults `next build` and `next dev` to Turbopack. This project's
**validated production path is Webpack** — the Dockerfile and CI both build
with `npm run build -- --webpack`, and `next.config.ts` carries Webpack-era
options (`outputFileTracingIncludes` for `sharp`) that this project relies
on for the standalone Docker image. Match production locally:

```bash
npm run build -- --webpack
npm run dev -- --webpack
```

README.md also notes that on Windows machines where native SWC bindings are
blocked by Application Control policy, Turbopack cannot run at all and
`--webpack` is required, not just recommended.

## 5. Feature flags

`src/lib/features.ts` defines per-store feature flags, stored as JSON on
`Store.features`. All flags default to `false`, so a store that never
touches them behaves exactly as it did before the flags existed. Core
POS/catalog logic stays flag-agnostic; only the optional extensions read
these flags.

| Flag | Gates |
|---|---|
| `units_enabled` | Units of measure and decimal quantities on products |
| `custom_variant_axes_enabled` | Custom variant axes beyond built-in size/color |
| `category_attributes_enabled` | Per-category custom attributes (spec fields) |
| `expiry_batch_enabled` | Batch/lot tracking and use-by date tracking |

To toggle a flag locally for testing, go to **Settings** in the running app
(a Manager can flip these for their own store), or set them directly on a
store row's `features` JSON column, or pass them in `prisma/seed.ts`'s
`DEMO_FEATURES` object before seeding. `getStoreFeatures(storeId)` in
`src/lib/features.ts` is the single read path — call it once per request
and reuse the result rather than calling the per-flag helpers repeatedly,
since each one hits the database independently.

## 6. Folder structure

- **`src/actions/`** — Server Actions, one file per domain (`products.ts`,
  `sales.ts`, `stores.ts`, `two-factor.ts`, etc.). This is where mutations
  and form submissions are handled; they run server-side and enforce
  authorization from the session, never from client input.
- **`src/app/`** — Next.js App Router routes: `(auth)/` and `(dashboard)/`
  route groups, `api/` route handlers, plus the root layout and error
  boundaries (`error.tsx`, `global-error.tsx`, `not-found.tsx`).
- **`src/components/`** — React components, grouped by feature area
  (`products/`, `sales/`, `settings/`, `users/`, etc.), plus a shared `ui/`
  directory for shadcn/Radix primitives.
- **`src/lib/`** — Framework-agnostic application logic: auth config,
  Prisma client, RBAC guards, sale math, CSV export, batch/expiry logic,
  the logger, and the feature-flag module described above. Most `*.test.ts`
  files sit next to the module they test here, since this is where the
  pure, DB-free logic lives.
- **`src/hooks/`** — React hooks (currently just `use-mobile.ts`).
- **`src/types/`** — Shared TypeScript types, including the NextAuth
  session type augmentation (`next-auth.d.ts`).
- **`src/generated/`** — The generated Prisma client
  (`src/generated/prisma/`). Not hand-written and not committed (see
  Troubleshooting below).

## 7. Debugging tips

Structured logging lives in `src/lib/logger.ts`, built on `pino`. It writes
JSON to stdout — no external log shipper is configured, since the
production platform (Coolify) captures container stdout natively.

- Use `scopedLogger(scope)` to get a logger tagged with one of `"app"`,
  `"auth"`, `"error"`, `"db"`, or `"system"`.
- Use `logServerError(scope, error, context?)` inside a Server Action or
  Route Handler `catch` block — it logs the error with `err` serialization
  and any extra context you pass.
- Control verbosity with `LOG_LEVEL` in `.env` (defaults to `debug` outside
  production, `info` in production).
- **Never** import `logger.ts` from `src/proxy.ts`, `auth.config.ts`, or
  anything else that runs on the Edge runtime — the comment in the file
  states this is Node-runtime only.

Locally, logs print straight to your terminal since `npm run dev` runs in
the foreground. In the Docker smoke test (`docker logs app-test`, see
`.github/workflows/ci.yml`) they show up the same way, as JSON lines.

## 8. Deployment (Coolify)

Pushing to `master` deploys to production automatically. The trigger is the
`deploy` job in `.github/workflows/ci.yml`, not Coolify's own git webhook:
Coolify's webhook fires the moment a commit lands, which would start a build
before typecheck, tests, or the container smoke test have said anything. The
Actions job runs only after both gates pass, so a red build never reaches
production.

Coolify builds the image itself from `Dockerfile` — nothing is pushed to a
registry.

### One-time setup

1. In Coolify, open the application, go to **Webhooks**, and copy the deploy
   URL. It looks like
   `https://<coolify-host>/api/v1/deploy?uuid=<app-uuid>&force=false`.
2. In Coolify, go to **Keys & Tokens > API tokens** and create a token with
   deploy permission.
3. In GitHub, go to **Settings > Secrets and variables > Actions** and add
   two repository secrets:
   - `COOLIFY_WEBHOOK` — the URL from step 1
   - `COOLIFY_TOKEN` — the token from step 2
4. In Coolify, **disable the application's automatic git deployment** so a
   push does not build twice, once from each trigger.

Until both secrets exist, the `deploy` job still runs but skips with a notice
on the run summary instead of failing — so CI does not go permanently red for
a deploy that has not been configured yet.

### Which vars are build-time

Only `DATABASE_URL` and `AUTH_SECRET` need Coolify's **Build Variable** box
ticked; the Dockerfile declares them as `ARG` so `next build` can run.

Leave it **unticked** for everything else, the `R2_*` group especially. A
build ARG is baked into the image history and printed in clear text into the
deploy log — a log you might paste somewhere. R2 credentials are read lazily
at request time (`src/lib/storage/r2.ts`), so they only ever need to be
runtime env.

### Migrations are not automatic

The deploy webhook rebuilds and restarts the container; it does not run
`prisma migrate deploy`. A release containing a migration needs it applied
against the production database before or as part of the rollout — otherwise
the new code starts against an old schema. Either add it as a pre-deploy
command in Coolify, or run it manually.

### Verifying a deploy

- GitHub **Actions** tab — the `Deploy (Coolify)` job is green.
- Coolify's **Deployments** tab shows the new build, keyed to the commit SHA.
- `curl https://<your-domain>/api/health` returns a JSON `status`. This is the
  same endpoint Coolify's health check should target.

### If a deploy takes an hour

The build server's IPv6 route to Docker Hub's CDN is unreliable: layer
downloads crawl and then die with `read: connection reset by peer` on an IPv6
socket pair. A deploy on 2026-09-18 spent 34 minutes on a single 14MB layer
before failing, never reaching `npm ci`.

The Dockerfile no longer puts Docker Hub on the critical path of every build
(the `# syntax=` directive is gone), but `FROM node:24-alpine` still pulls
over the same route on a cold cache. Two host-side settings make that stop
hurting. Both are applied on the Coolify server, not in this repo.

Prefer IPv4 for name resolution — append to `/etc/gai.conf`, then
`systemctl restart docker`:

```
precedence ::ffff:0:0/96  100
```

Keep the BuildKit cache between deploys — `/etc/docker/daemon.json`:

```json
{
  "builder": {
    "gc": {
      "enabled": true,
      "policy": [{ "keepStorage": "20GB", "filter": ["unused-for=720h"] }]
    }
  },
  "max-concurrent-downloads": 3
}
```

Coolify's own "Force Docker Cleanup" prunes build data on a nightly cron and
will undo this — raise its disk threshold or turn it off. Without a warm
cache, every deploy re-downloads ~1000 npm tarballs over the bad link.

## 9. Troubleshooting

- **"Cannot find module '../generated/prisma/client'" or a stale Prisma
  client after a schema change.** The Prisma client is generated to a
  non-default path, `src/generated/prisma` (`prisma/schema.prisma`'s
  `generator client { output = "../src/generated/prisma" }`), and that path
  is gitignored. It's regenerated automatically by `postinstall`, `predev`,
  and `prebuild` hooks in `package.json`, so `npm install`, `npm run dev`,
  and `npm run build` all trigger it. If you ever run `npx next dev` or
  `npx next build` directly (bypassing the `npm run` script), run
  `npx prisma generate` yourself first.
- **Turbopack fails to start, or errors mention native SWC bindings.** On
  Windows machines with Application Control policies blocking native
  binaries, Turbopack cannot run at all. Add `--webpack` to your `dev`/
  `build` command (see §4). This is also the flag CI and the Docker build
  use, so it is the better default to develop against regardless of
  platform.
- **Image uploads 500 in a locally-built Docker container but work with
  `npm run dev`.** This is a known native-module tracing gap: Next's file
  tracer can miss `sharp`'s platform-specific binaries when building the
  standalone output. `next.config.ts` forces `sharp`/`@img` into the trace
  for `/api/uploads`, and the Dockerfile copies `node_modules/sharp` and
  `node_modules/@img` into the runner image explicitly as a second layer of
  insurance. If you hit this outside Docker, it isn't this issue — check
  that `sharp` installed correctly for your platform instead.
