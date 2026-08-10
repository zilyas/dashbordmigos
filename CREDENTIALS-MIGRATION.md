# Credentials Migration: .env to CI Secrets

## Overview

This document guides moving sensitive credentials from the `.env` file to your CI/CD platform's secret management system. This eliminates the risk of credentials being accidentally committed or leaked through local machine compromises.

## Credentials to Migrate

The following credentials in `.env` must be moved to CI secrets:

| Credential | Current Location | Risk | Action |
|------------|------------------|------|--------|
| `DATABASE_URL` | `.env:14` | Full database access if leaked | Move to CI secrets |
| `DIRECT_URL` | `.env:15` | Full database access if leaked | Move to CI secrets |
| `AUTH_SECRET` | `.env:16` | Session signing/forgery if leaked | Move to CI secrets |
| `R2_ACCOUNT_ID` | `.env:3` | R2 bucket access if leaked | Move to CI secrets |
| `R2_ACCESS_KEY_ID` | `.env:4` | R2 bucket access if leaked | Move to CI secrets |
| `R2_SECRET_ACCESS_KEY` | `.env:5` | R2 bucket access if leaked | Move to CI secrets |
| `EXPIRY_CRON_SECRET` | `.env:12` | Cron job access if leaked | Move to CI secrets |
| `UPSTASH_REDIS_REST_URL` | `.env:9` | Redis access if leaked | Move to CI secrets |
| `UPSTASH_REDIS_REST_TOKEN` | `.env:10` | Redis access if leaked | Move to CI secrets |

**Safe to keep in `.env`:**
- `NODE_ENV` (set per environment anyway)
- `NEXT_PUBLIC_*` (public environment variables)
- `LOG_LEVEL` (non-sensitive)

## Migration Steps

### Step 1: Prepare Local Development

Create a `.env.local` file for local development with placeholder values:

```bash
# .env.local - DO NOT COMMIT
DATABASE_URL="postgresql://user:password@localhost:5432/dashbordmigos_dev"
DIRECT_URL="postgresql://user:password@localhost:5432/dashbordmigos_dev"
AUTH_SECRET="local-dev-secret-32-bytes-minimum"
R2_ACCOUNT_ID="local-dev-account-id"
R2_ACCESS_KEY_ID="local-dev-key-id"
R2_SECRET_ACCESS_KEY="local-dev-secret-key"
EXPIRY_CRON_SECRET="local-dev-cron-secret"
UPSTASH_REDIS_REST_URL="http://localhost:8079"
UPSTASH_REDIS_REST_TOKEN="local-dev-token"
```

Ensure `.env.local` is in `.gitignore` (it already is via `.env*` pattern).

### Step 2: GitHub Actions (Recommended)

#### 2a. Add Secrets to GitHub

1. Go to your repository on GitHub
2. Navigate to **Settings > Secrets and variables > Actions**
3. Click **New repository secret**
4. Add each credential with the exact same name as the environment variable:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `AUTH_SECRET`
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `EXPIRY_CRON_SECRET`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

#### 2b. Update GitHub Actions Workflow

In your `.github/workflows/*.yml` files, pass secrets to the job:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      DIRECT_URL: ${{ secrets.DIRECT_URL }}
      AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
      R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
      R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      EXPIRY_CRON_SECRET: ${{ secrets.EXPIRY_CRON_SECRET }}
      UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
      UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "18"
      - run: npm ci
      - run: npm run build
```

#### 2c. Update Deployment Workflow

If you deploy from GitHub Actions to production:

```yaml
deploy:
  runs-on: ubuntu-latest
  environment: production  # Optional: use GitHub environments for per-environment secrets
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    DIRECT_URL: ${{ secrets.DIRECT_URL }}
    AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
    R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
    R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
    R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
    EXPIRY_CRON_SECRET: ${{ secrets.EXPIRY_CRON_SECRET }}
    UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
    UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
  steps:
    - uses: actions/checkout@v4
    - run: npm run deploy  # Or your deployment command
```

### Step 3: Alternative CI/CD Platforms

#### GitLab CI

```yaml
variables:
  DATABASE_URL: $DATABASE_URL
  DIRECT_URL: $DIRECT_URL
  AUTH_SECRET: $AUTH_SECRET
  R2_ACCOUNT_ID: $R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID: $R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY: $R2_SECRET_ACCESS_KEY
  EXPIRY_CRON_SECRET: $EXPIRY_CRON_SECRET
  UPSTASH_REDIS_REST_URL: $UPSTASH_REDIS_REST_URL
  UPSTASH_REDIS_REST_TOKEN: $UPSTASH_REDIS_REST_TOKEN
```

Then add these variables in **Settings > CI/CD > Variables**.

#### Vercel

If deploying to Vercel:

1. Go to **Project Settings > Environment Variables**
2. Add each secret for the desired environments (Preview, Production)
3. Vercel automatically passes them to the build and runtime

#### Netlify

If deploying to Netlify:

1. Go to **Site settings > Build & deploy > Environment**
2. Add each secret
3. Netlify automatically injects them during build

### Step 4: Update the `.env` File

After migrating to CI secrets, update the `.env` file to remove all sensitive values:

```bash
# .env - SAFE TO COMMIT (no secrets)
NODE_ENV=production
NEXT_PUBLIC_APP_NAME=Dashbordmigos
LOG_LEVEL=info

# ===== CREDENTIALS MANAGED BY CI/CD =====
# The following are injected at build/runtime by CI secrets:
# DATABASE_URL (from CI secrets)
# DIRECT_URL (from CI secrets)
# AUTH_SECRET (from CI secrets)
# R2_ACCOUNT_ID (from CI secrets)
# R2_ACCESS_KEY_ID (from CI secrets)
# R2_SECRET_ACCESS_KEY (from CI secrets)
# EXPIRY_CRON_SECRET (from CI secrets)
# UPSTASH_REDIS_REST_URL (from CI secrets)
# UPSTASH_REDIS_REST_TOKEN (from CI secrets)
```

### Step 5: Test Locally

```bash
# Test with .env.local (local secrets)
npm run dev

# Verify the app starts without errors
# Check that database, R2, and Redis connections work
```

### Step 6: Test in CI/CD

```bash
# Commit the changes and push
git add .env CREDENTIALS-MIGRATION.md .pre-commit-config.yaml src/middleware.ts src/lib/store-context.ts
git commit -m "chore: move credentials to CI secrets, add edge middleware, validate user status"
git push origin main

# Check CI/CD logs to verify secrets were injected correctly
# (secrets themselves should be masked in logs)
```

## Verification Checklist

- [ ] `.env.local` created with placeholder values (git-ignored)
- [ ] CI/CD secrets added (GitHub Secrets, GitLab Variables, etc.)
- [ ] Workflow files updated to pass secrets as environment variables
- [ ] `.env` file updated with only non-sensitive values
- [ ] Local development still works with `.env.local`
- [ ] CI/CD pipeline successfully builds and deploys
- [ ] Application runs correctly with CI-injected secrets
- [ ] Pre-commit gitleaks hook installed: `pip install pre-commit && pre-commit install`
- [ ] Test: Try committing a fake secret to verify gitleaks blocks it

## Long-Term: Rotating Secrets

Now that credentials are in CI secrets, rotation is safer:

1. **Database**: Rotate password in database provider, update CI secret
2. **R2**: Regenerate access key in Cloudflare dashboard, update CI secret
3. **AUTH_SECRET**: Generate new 32-byte base64 string, update CI secret (invalidates all sessions)
4. **Redis**: Rotate token in Upstash dashboard, update CI secret

## References

- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [GitLab CI/CD Variables](https://docs.gitlab.com/ee/ci/variables/)
- [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables)
- [Gitleaks Documentation](https://github.com/gitleaks/gitleaks)
