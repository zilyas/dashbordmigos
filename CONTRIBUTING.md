# Contributing

This guide covers commit conventions, the PR checklist, code style, and
testing expectations for this repository. See
[DEVELOPMENT.md](./DEVELOPMENT.md) for environment setup.

## 1. Commit conventions

This repository does not document a branch-naming convention anywhere, and
only `master` currently exists in the remote (no other branches to infer a
pattern from). **Open question — ask the maintainer before assuming a
pattern.**

Commit messages follow **Conventional Commits** — this is the actual
pattern in `git log`, not an idealized one. Recent history (the last ~19
commits) is consistently `type(scope): description`, lowercase, imperative
mood:

```
fix(security): remove credential leaks from reset and seed
feat(inventory): add expiry reports and notifications
ci: add validation-only GitHub Actions pipeline
docs: add phase tracker and design notes
test: verify multi-vertical feature interactions
chore: add repo and tooling config
```

Types seen in history: `feat`, `fix`, `ci`, `docs`, `test`, `chore`,
`security` (used both as a bare type and as `fix(security):` — both occur).
Scopes match a feature area, e.g. `(inventory)`, `(products)`, `(variants)`,
`(security)`, `(settings)`, `(deps)`.

Note: the repository's earliest commits (before `dc6ea76`) are plain
capitalized sentences without a `type(scope):` prefix, e.g. "Fix seller
deletion failing with a raw database error". That's leftover from before
the convention was adopted — follow the `type(scope): description` pattern
used in all recent commits, not the old style.

## 2. PR checklist

`.github/workflows/ci.yml` runs on every push and PR to every branch and is
a **validation gate only** — it never deploys. Your PR must pass all of
these, in this order, before it can merge:

1. **Secret scan** — `gitleaks detect` over the full commit history. A
   leaked credential fails the run in seconds, before anything installs or
   builds. The same check runs locally as a pre-commit hook if you've
   installed one (see `.pre-commit-config.yaml`: `pre-commit install`).
2. **`npx prisma validate`** — schema must be valid.
3. **`npx tsc --noEmit`** — typecheck.
4. **`npx eslint .`** — lint.
5. **`npm run test`** — vitest unit tests.
6. **`npm run build -- --webpack`** — production build, explicitly on
   Webpack (see DEVELOPMENT.md §4 for why).

A second CI job, `container-smoke`, builds the production Docker image and
curls `/api/health` on a running container. It doesn't gate on anything
you're likely to touch in day-to-day app code, but a change to the
Dockerfile, `next.config.ts`'s `output: "standalone"` tracing, or the
health route will affect it.

Branch protection with required status checks is **not** enforced by any
file in this repo — it's a manual GitHub setting (Settings → Branches). Ask
the maintainer whether it's turned on for `master` before assuming a red CI
run blocks merge.

## 3. Code style

`eslint.config.mjs` extends `eslint-config-next`'s `core-web-vitals` and
`typescript` rule sets, with no custom rule overrides. `src/generated/**`
(the Prisma client) is excluded from linting, since it isn't hand-written.

Beyond what eslint enforces, the codebase's own convention — confirmed by
reading `src/lib/features.ts`, `src/lib/logger.ts`, `prisma/seed.ts`, and
`next.config.ts` — is **short "why" comments over verbose JSDoc**. Comments
explain a non-obvious decision or constraint in a sentence or two (e.g. why
a flag defaults to false, why a module can't run on the Edge runtime, why a
value falls back to another env var), not full parameter-by-parameter
documentation blocks. Match that: if a comment doesn't answer "why would
someone be confused here," it's probably not needed.

## 4. Testing expectations

`vitest.config.mts` scopes tests to `src/**/*.test.ts`, run with
`environment: "node"`. There are 10 test files today, all under
`src/lib/**` (e.g. `sale-math.test.ts`, `expiry.test.ts`,
`batches.test.ts`, `csv.test.ts`, `variant-axes.test.ts`,
`storage/r2.test.ts`).

**There is no database in CI.** `.github/workflows/ci.yml` states this
explicitly: no Postgres service container is started, and the placeholder
`DATABASE_URL` it sets points at an unreachable host. This is verified,
not assumed — none of the current test files import Prisma or touch a
database.

What this means for what you can test here:

- **Write a test for pure logic** — money/quantity math, formatting,
  validation, allocation/FEFO logic, CSV escaping — anything that doesn't
  need Prisma or a live database. This is what `src/lib/*.test.ts` covers
  today and where new tests should go.
- **Don't write a test that needs a running database.** There's no
  fixture, no test database, and no CI service to run it against. If your
  change needs DB-backed integration coverage, that's a gap to flag to the
  maintainer, not something to quietly add — a test that can't run in CI
  will either be skipped everywhere or fail everywhere.
- Server Actions and Route Handlers that call Prisma directly are exercised
  today by manual/production verification, not automated tests. If you can
  extract the pure logic (e.g. the math, the eligibility check) into a
  `src/lib/` function and test that in isolation, prefer that over trying
  to test the action itself.

## 5. Before you open a PR

Run the same checks CI runs, locally, in this order:

```bash
npx tsc --noEmit
npx eslint .
npm run test
npm run build -- --webpack
```

All four must be clean. If `gitleaks` is installed
(`pip install pre-commit && pre-commit install`), it already runs on every
commit — otherwise, double-check you haven't committed a real credential
before pushing, since CI's secret scan will fail the whole run.
