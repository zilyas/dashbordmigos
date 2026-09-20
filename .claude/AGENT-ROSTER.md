# Which agent to use on this project

265 agents from the `agency-agents-main` pack are installed globally in
`~/.claude/agents/`, so they are already available here — nothing needs to be
copied into this repo. Invoke one with the Agent tool using its fully qualified
name, e.g. `subagent_type: "engineering-frontend-developer"`.

Most of the roster is for other domains (game engines, GIS, healthcare, paid
media). This file lists only the agents that fit **this** codebase — a Next.js
16 + Prisma + Postgres multi-tenant retail dashboard — so nobody has to read
265 descriptions to pick one.

## The short list

| Task | Agent |
|---|---|
| React / Next.js UI work, component structure, client state | `engineering-frontend-developer` |
| Server actions, queries, data model, multi-tenant scoping | `engineering-backend-architect` |
| Prisma schema, indexes, slow queries, N+1 | `engineering-database-optimizer` |
| Review a diff before it ships | `engineering-code-reviewer` |
| Keep a fix small instead of letting it become a refactor | `engineering-minimal-change-engineer` |
| Auth, sessions, store permissions, RBAC | `engineering-identity-access-engineer` |
| Secrets, credential handling, R2 keys | `security-secrets-credential-engineer` |
| Defensive security pass over auth / headers / validation | `security-senior-secops` |
| Docker, Coolify, CI, deploys | `engineering-devops-automator` |
| Playwright / Vitest coverage, flake hunting | `engineering-test-automation-engineer` |
| Keyboard access, ARIA, contrast on dashboard screens | `testing-accessibility-auditor` |
| Charts and reporting screens | `engineering-data-visualization-engineer` |
| Core Web Vitals, bundle size, render cost | `testing-performance-benchmarker` |
| Orient a new contributor in this repo | `engineering-codebase-onboarding-engineer` |
| README / runbook / API docs | `engineering-technical-writer` |

## Rules that apply to every dispatch here

1. **Read `.claude/skills/dashbordmigos-project-guide` first.** Store scoping
   (`requireStoreId`), the feature flags, and `src/proxy.ts` (this project's
   middleware) are not guessable from the file tree.
2. **Use graft, not grep.** The repo is indexed; `graft ask "<task>" --source`
   returns the code inline at exact `file:line`.
3. **Parallelise only across files.** Agents editing the same file collide.
   Split by file boundary, not by subtask.
4. **The gate is non-negotiable** before reporting done:
   `npx tsc --noEmit && npx eslint . && npm run test && npm run build -- --webpack`
5. **No new git worktrees.** Jean owns worktree creation for this project.

## What is not installed

15 game-engine agents (Unity, Unreal, Godot, Roblox, Blender) and the NEXUS
strategy playbooks from the pack are absent. The engine agents have no use
here. The playbooks are prose documents with no frontmatter, so they are not
invocable agents — read them in the source repo if you want the orchestration
patterns.
