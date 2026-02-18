# Master Prompt: Autonomous GitHub Mirror Build (Convex + Effect + Confect)

You are Claude Opus running fully autonomously in this repository.

Your mission is to convert this codebase into a fast GitHub UI backed by Convex as a cache/sync layer.

GitHub is the source of truth.
Convex is the low-latency read model.

## Project Context (Read First)

- You are currently in `create-epoch-app`, which is a starter template.
- Nothing in this template is sacred.
- Backward compatibility is **not required**.
- You may freely add/rename/remove modules as needed.
- You may upgrade/change Convex packages and Convex React usage whenever necessary.

## Resolved Decisions (Feb 2026)

These decisions were made before autonomous execution began. Do not re-ask.

1. **GitHub App → Not needed initially.** Use **repository-level webhooks** with the existing GitHub OAuth token / PAT. Repos are added manually via an admin mutation or CLI, which creates a repo-level webhook via `gh api`. The `installationId` field is kept in schema for forward-compatibility with a future GitHub App migration, but populated with `0` in repo-webhook mode.
2. **Git → Local repo only.** No remote push unless explicitly requested. Commit locally with clear messages.
3. **Starter code → Nuke domain, preserve patterns.** Delete guestbook/posts/users domain code. Keep confect setup patterns, UI component library (`@packages/ui`), observability infra as scaffolding. Ignore `apps/discord-bot` (out of scope).
4. **Auth → Public, no login required.** Strip Better Auth from active schema and HTTP routes. The `@packages/ui` components and auth packages can stay installed for future use, but nothing in the active codepath should require authentication.
5. **Confect → All tables.** Use Confect `defineTable` with Effect Schema for every table, including ingestion plumbing (webhook_events_raw, sync_jobs, dead_letters). Consistent patterns everywhere.
6. **Testing → `@packages/convex-test` is primary.** Use fixture payloads, reproducible webhook harnesses, and Convex-test integration tests. No external dependencies required for CI-critical tests.

## Product Objective

Build a GitHub mirror system where:

1. GitHub repo-level webhooks stream incremental updates into Convex.
2. Backfill jobs pull historical data from GitHub REST/GraphQL API into Convex.
3. Reconciliation jobs repair missed or out-of-order changes.
4. One-time repository bootstrap sync runs automatically when new repositories are connected.
5. The UI reads from Convex projections only for fast, stable page loads.
6. Repos are connected manually (admin mutation / CLI command) — no GitHub App installation flow needed initially.

## Prerequisites

Before the sync pipeline works end-to-end, these must be in place:

- `CONVEX_DEPLOYMENT` set in `.env` (already done)
- `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_SITE_URL` set (already done)
- A GitHub PAT or OAuth token available via `gh auth status` (already done)
- `GITHUB_WEBHOOK_SECRET` set in `.env` (to be generated during Slice 0)
- A **public test repo** on `RhysSullivan`'s GitHub account for end-to-end testing (created during Slice 0)

Not needed initially:
- GitHub App ID / private key (future migration)
- Better Auth secrets (stripped from active use)

## Test Repository

Create a public repo `RhysSullivan/quickhub-test` via `gh repo create` during Slice 0. This repo is used for:

- End-to-end webhook delivery testing (real webhooks from GitHub → Convex HTTP endpoint)
- Backfill / bootstrap testing against real GitHub API data
- Creating test issues, PRs, branches, and commits programmatically via `gh` CLI
- Validating the full pipeline: webhook → ingestion → normalized tables → projections → UI

The test repo should be treated as disposable — it can be deleted and recreated at any time. All CI-critical tests remain offline-capable via fixture replay, but live smoke tests use this repo.

## Autonomy Rules

1. Work in small vertical slices: schema -> sync -> projection -> UI -> tests.
2. Commit frequently with clear messages.
3. Use GitHub CLI (`gh`) for GitHub operations.
4. Use Convex CLI for deploy/run/log/sync operations.
5. Prefer idempotent and replay-safe behavior over shortcuts.
6. Assume webhook events can be delayed, duplicated, or out-of-order.
7. Keep the repo in a runnable state after each slice.
8. **This plan is a living document.** Update it autonomously whenever you discover better approaches, resolve ambiguities, or learn something that future sessions need to know. Don't ask permission to edit this file — just do it and note what changed in the status notes. The goal is for this file to always reflect the current best understanding of the project.
9. **No workarounds or hackery.** If a library or internal package doesn't support what you need, fix the library. Specifically: if Confect doesn't expose proper types, update `packages/confect/src/`. If Effect patterns need a utility, add it. The codebase should be clean and correct, not held together with adapter shims.

## Repeated Prompt / Resume Protocol (Important)

Assume this master prompt is sent repeatedly in fresh sessions.

Treat this file as a goal reminder plus execution ledger.

At the start of every run, do this before coding:

1. Read `PLAN.md` status notes to find the last completed step and next intended step.
2. Inspect git state (`git status`, recent commits, current branch) to confirm actual progress.
3. Reconcile differences between notes and code reality.
4. Continue from the highest-value unfinished slice.
5. If previous run was interrupted, recover safely from partial work (do not restart from zero unless necessary).

End every run by appending a short status block in this file with:

- completed work,
- in-progress work,
- exact next command/function/task to run,
- blockers or risks.

## Personal Notes Protocol

Write ongoing notes to `personal-notes/` as you work.

- Keep a running implementation note per workstream with descriptive filenames.
- Create new files when starting a distinct investigation or subsystem.
- Include concrete breadcrumbs: decisions, tradeoffs, failed attempts, and why.
- Record exact commands/results that matter for resuming work quickly.
- Prefer filenames like `github_sync_bootstrap_design_feb_2026.md`.
- Do not store secrets/tokens in notes.

## Stack and Code Constraints

- Use `bun` for package scripts/commands.
- Use Effect services/layers and tagged errors.
- Keep using Confect patterns for typed Convex RPC modules.
- Do not use TypeScript `any`, `unknown`, or type assertions.
- Prefer existing monorepo package import conventions.
- Write backend sync/data tests using `@packages/convex-test` (do not skip Convex-test-based coverage).

## Architecture

Core pipeline:

`GitHub API + GitHub Webhooks -> Ingestion -> Normalized Convex Tables -> Projection Tables -> Next.js UI`

### What We Sync (and What We Don't)

**In scope:** Repository metadata, branches, commits (metadata only), pull requests, PR reviews, issues, issue comments, check runs. This is a **metadata mirror** — think GitHub dashboard, not GitHub code viewer.

**Explicitly out of scope:**
- **File/code content** — no tree/blob sync, no diffs, no file browsing
- **Git object storage** — no cloning repos or storing git packs
- **Code search** — no indexing of source files
- **Release assets / packages** — not synced
- **GitHub Actions workflow definitions** — only check run results are synced, not workflow YAML
- **Discussions / Projects / Wiki** — not in initial scope

Sync modes:

1. **Bootstrap Backfill**: initial hydration.
2. **Realtime Webhook Sync**: ongoing updates.
3. **Periodic Reconciliation**: drift and gap repair.
4. **One-Time Repository Bootstrap**: immediate first sync for newly added repos.

## Data Model (Target)

Implement 3 layers in Convex:

1. Raw ingest layer (audit + replay)
2. Normalized canonical domain layer
3. Read projection layer for UI

### A) Control + Ingestion Tables

- `github_installations`
  - `installationId: number` (use `0` for repo-webhook mode; real value when GitHub App is added)
  - `accountId: number`
  - `accountLogin: string`
  - `accountType: "User" | "Organization"`
  - `suspendedAt: number | null`
  - `permissionsDigest: string` (empty string for repo-webhook mode)
  - `eventsDigest: string` (empty string for repo-webhook mode)
  - `updatedAt: number`
  - indexes:
    - `by_installationId`
    - `by_accountLogin`
  - **Note:** In repo-webhook mode, create one row per connected GitHub account (user/org). This table exists for forward-compatibility with GitHub App installations. For now, it tracks which accounts have repos connected to this mirror.

- `github_sync_jobs`
  - `jobType: "backfill" | "reconcile" | "replay"`
  - `scopeType: "installation" | "repository" | "entity"`
  - `triggerReason: "install" | "repo_added" | "manual" | "reconcile" | "replay"`
  - `lockKey: string` (dedupe key, e.g. `repo-bootstrap:<installationId>:<repositoryId>`)
  - `installationId: number | null`
  - `repositoryId: number | null`
  - `entityType: string | null`
  - `state: "pending" | "running" | "retry" | "done" | "failed"`
  - `attemptCount: number`
  - `nextRunAt: number`
  - `lastError: string | null`
  - `createdAt: number`
  - `updatedAt: number`
  - indexes:
    - `by_lockKey`
    - `by_state_and_nextRunAt`
    - `by_scopeType_and_installationId`

- `github_sync_cursors`
  - `cursorKey: string`
  - `cursorValue: string | null`
  - `watermarkAt: number | null`
  - `updatedAt: number`
  - indexes:
    - `by_cursorKey`

- `github_webhook_events_raw`
  - `deliveryId: string`
  - `eventName: string`
  - `action: string | null`
  - `installationId: number | null`
  - `repositoryId: number | null`
  - `signatureValid: boolean`
  - `payloadJson: string`
  - `receivedAt: number`
  - `processState: "pending" | "processed" | "failed"`
  - `processError: string | null`
  - indexes:
    - `by_deliveryId`
    - `by_processState_and_receivedAt`
    - `by_installationId_and_receivedAt`

- `github_dead_letters`
  - `deliveryId: string`
  - `reason: string`
  - `payloadJson: string`
  - `createdAt: number`
  - indexes:
    - `by_createdAt`

### B) Normalized Domain Tables

- `github_users`
  - `githubUserId: number`
  - `login: string`
  - `avatarUrl: string | null`
  - `siteAdmin: boolean`
  - `type: "User" | "Bot" | "Organization"`
  - `updatedAt: number`
  - indexes: `by_githubUserId`, `by_login`

- `github_organizations`
  - `githubOrgId: number`
  - `login: string`
  - `name: string | null`
  - `avatarUrl: string | null`
  - `updatedAt: number`
  - indexes: `by_githubOrgId`, `by_login`

- `github_repositories`
  - `githubRepoId: number`
  - `installationId: number`
  - `ownerId: number`
  - `ownerLogin: string`
  - `name: string`
  - `fullName: string`
  - `private: boolean`
  - `visibility: "public" | "private" | "internal"`
  - `defaultBranch: string`
  - `archived: boolean`
  - `disabled: boolean`
  - `fork: boolean`
  - `pushedAt: number | null`
  - `githubUpdatedAt: number`
  - `cachedAt: number`
  - indexes:
    - `by_githubRepoId`
    - `by_installationId_and_fullName`
    - `by_ownerLogin_and_name`
    - `by_installationId_and_githubUpdatedAt`

- `github_branches`
  - `repositoryId: number`
  - `name: string`
  - `headSha: string`
  - `protected: boolean`
  - `updatedAt: number`
  - indexes:
    - `by_repositoryId_and_name`
    - `by_repositoryId_and_headSha`

- `github_commits`
  - `repositoryId: number`
  - `sha: string`
  - `authorUserId: number | null`
  - `committerUserId: number | null`
  - `messageHeadline: string`
  - `authoredAt: number | null`
  - `committedAt: number | null`
  - `additions: number | null`
  - `deletions: number | null`
  - `changedFiles: number | null`
  - `cachedAt: number`
  - indexes:
    - `by_repositoryId_and_sha`
    - `by_repositoryId_and_committedAt`

- `github_pull_requests`
  - `repositoryId: number`
  - `githubPrId: number`
  - `number: number`
  - `state: "open" | "closed"`
  - `draft: boolean`
  - `title: string`
  - `body: string | null`
  - `authorUserId: number | null`
  - `assigneeUserIds: Array<number>`
  - `requestedReviewerUserIds: Array<number>`
  - `baseRefName: string`
  - `headRefName: string`
  - `headSha: string`
  - `mergeableState: string | null`
  - `mergedAt: number | null`
  - `closedAt: number | null`
  - `githubUpdatedAt: number`
  - `cachedAt: number`
  - indexes:
    - `by_repositoryId_and_number`
    - `by_repositoryId_and_state_and_githubUpdatedAt`
    - `by_repositoryId_and_headSha`

- `github_pull_request_reviews`
  - `repositoryId: number`
  - `pullRequestNumber: number`
  - `githubReviewId: number`
  - `authorUserId: number | null`
  - `state: string`
  - `submittedAt: number | null`
  - `commitSha: string | null`
  - indexes:
    - `by_repositoryId_and_pullRequestNumber`
    - `by_repositoryId_and_githubReviewId`

- `github_issues`
  - `repositoryId: number`
  - `githubIssueId: number`
  - `number: number`
  - `state: "open" | "closed"`
  - `title: string`
  - `body: string | null`
  - `authorUserId: number | null`
  - `assigneeUserIds: Array<number>`
  - `labelNames: Array<string>`
  - `commentCount: number`
  - `isPullRequest: boolean`
  - `closedAt: number | null`
  - `githubUpdatedAt: number`
  - `cachedAt: number`
  - indexes:
    - `by_repositoryId_and_number`
    - `by_repositoryId_and_state_and_githubUpdatedAt`

- `github_issue_comments`
  - `repositoryId: number`
  - `issueNumber: number`
  - `githubCommentId: number`
  - `authorUserId: number | null`
  - `body: string`
  - `createdAt: number`
  - `updatedAt: number`
  - indexes:
    - `by_repositoryId_and_issueNumber`
    - `by_repositoryId_and_githubCommentId`

- `github_check_runs`
  - `repositoryId: number`
  - `githubCheckRunId: number`
  - `name: string`
  - `headSha: string`
  - `status: string`
  - `conclusion: string | null`
  - `startedAt: number | null`
  - `completedAt: number | null`
  - indexes:
    - `by_repositoryId_and_githubCheckRunId`
    - `by_repositoryId_and_headSha`

### C) UI Read Projection Tables

- `view_repo_overview`
  - per-repo counters and quick status
  - fields: `openPrCount`, `openIssueCount`, `failingCheckCount`, `lastPushAt`, `syncLagSeconds`
  - index: `by_repositoryId`

- `view_repo_pull_request_list`
  - flattened PR list cards
  - index: `by_repositoryId_and_sortUpdated`

- `view_repo_issue_list`
  - flattened issue list cards
  - index: `by_repositoryId_and_sortUpdated`

- `view_activity_feed`
  - normalized activity events
  - indexes:
    - `by_repositoryId_and_createdAt`
    - `by_installationId_and_createdAt`

## Sync Guarantees (Non-Negotiable)

1. Idempotent upserts by GitHub IDs.
2. Out-of-order protection using timestamps/version checks.
3. At-least-once webhook compatibility.
4. Full replay support from raw events.
5. Backfill pagination with durable checkpoints.
6. New repository onboarding performs exactly one active bootstrap job per repo (deduped by `lockKey`).

## One-Time Repository Bootstrap Rules

Implement this behavior explicitly:

1. Trigger repository bootstrap sync when:
   - A repo is manually connected via admin mutation / CLI (`connectRepo` mutation)
   - A webhook event references a repo not yet in the system (auto-discovery)
   - (Future: `installation_repositories` with `repositories_added` when GitHub App is added)
   - (Future: `repository.created` / `repository.transferred` via GitHub App)
2. Enqueue one repository-scoped backfill job per repo using deterministic `lockKey`.
3. If a queued/running bootstrap already exists for the same repo, do not create duplicates.
4. Bootstrap pipeline for each repo must fetch at minimum:
   - repository metadata (via GitHub REST API using PAT / `gh api`)
   - default branch + branch heads
   - recent commits window
   - pull requests
   - issues + issue comments
   - check runs for active PR head SHAs
5. Mark repo as `bootstrapCompleteAt` once minimum dataset is written.
6. After bootstrap complete, repo transitions to normal webhook + reconcile flow.
7. If bootstrap fails, retry with backoff; after retry exhaustion, move to dead-letter + alert.
8. Support manual bootstrap retry command for a single repo.
9. When connecting a repo, also create a repo-level webhook via GitHub API pointing to the Convex HTTP endpoint.

## GitHub CLI Instructions

Use `gh` and `gh api` for setup and operations. We use **repository-level webhooks** (not a GitHub App), so all webhook operations target `/repos/<owner>/<repo>/hooks`.

The webhook target URL is `${CONVEX_SITE_URL}/api/github/webhook` (the Convex HTTP endpoint).

Core commands:

- auth/context:
  - `gh auth status`
  - `gh repo view <owner>/<repo>`
- webhook list:
  - `gh api /repos/<owner>/<repo>/hooks`
- webhook create (for connecting a repo):
  - `gh api --method POST /repos/<owner>/<repo>/hooks -f name=web -f active=true -f 'events[]=push' -f 'events[]=pull_request' -f 'events[]=issues' -f 'events[]=issue_comment' -f 'events[]=check_run' -f 'events[]=pull_request_review' -f "config[url]=${CONVEX_SITE_URL}/api/github/webhook" -f 'config[content_type]=json' -f "config[secret]=${GITHUB_WEBHOOK_SECRET}"`
- deliveries:
  - `gh api /repos/<owner>/<repo>/hooks/<hook_id>/deliveries`
- redeliver:
  - `gh api --method POST /repos/<owner>/<repo>/hooks/<hook_id>/deliveries/<delivery_id>/attempts`

Backfill guidance:

- Use GraphQL (`gh api graphql --paginate`) where page traversal is cleaner.
- Use REST for webhook-aligned entities and simpler payload mapping.
- Auth: the existing `gh` OAuth token is used for all API calls (no GitHub App installation token needed).

## Convex CLI Instructions

Run from `packages/database` unless required otherwise.

- local dev: `bun run --filter @packages/database dev`
- codegen: `bun run --filter @packages/database codegen`
- deploy: `bun run --filter @packages/database deploy`
- run function: `bunx convex run <functionRef> '<jsonArgs>'`
- logs: `bunx convex logs`

After each sync slice:

1. Check ingestion count vs expected webhook deliveries.
2. Check normalized table counts and key indexes.
3. Check projection tables for expected UI rows.
4. For repo onboarding tests, verify repo appears end-to-end after a single bootstrap run.

## Convex Components and `.context` Guidance

Use local context repos and docs before reinventing Convex primitives.

- Inspect `.context/convex-backend` and `.context/convex-js` for implementation patterns and constraints.
- If building counters/rollups (for example PR/issue counts), evaluate Convex components (for example aggregate-style components) instead of custom ad-hoc counting in hot paths.
- If a component improves correctness/performance/operability, add it and wire it in `packages/database/convex/convex.config.ts`.
- You may diverge from this plan when component-based architecture is the better solution; document the decision in `PLAN.md` status notes.

## Confect Usage Note (Important)

Use Confect as the application-level contract between Convex handlers and clients.

- Define schema with `defineSchema` / `defineTable` in `packages/database/convex/schema.ts`.
- Define typed contexts in `packages/database/convex/confect.ts`.
- Build modules with `createRpcFactory` + `makeRpcModule`.
- Put read endpoints in `factory.query`, writes in `factory.mutation`, external side effects in `factory.action`.
- Keep middleware explicit (auth, telemetry, request policies).
- Use Effect layers for GitHub clients and sync services; consume with `yield*` dependencies.

### Confect is ours — update it when needed

`packages/confect/` is a first-party package in this monorepo. If Confect doesn't expose the right types, has missing APIs, or has ergonomic gaps — **fix Confect directly**. Do not create workaround utilities, adapter files, or `as` casts to paper over Confect's limitations.

Examples of when to update Confect:
- If `withIndex` typed its callback parameter as `unknown`, fix `ctx.ts` to expose proper `LooseIndexRangeBuilder` types.
- If `ConfectQueryInitializer` doesn't support a Convex feature you need (e.g. `.filter()` with typed builders), add it.
- If the schema definition doesn't handle a Convex validator pattern, extend `schema.ts` or `validators.ts`.

After updating Confect, make sure existing tests still pass (`bun run test` from `packages/confect/`).

## Testing Requirements

Testing must include Convex-test-based validation.

- Use `@packages/convex-test` for backend/domain/sync/projection tests.
- Prefer realistic integration tests over hand-written mocks for GitHub behavior.
- Use the real GitHub TypeScript SDK stack (`@octokit/*`) in tests where feasible.
- Build a reproducible webhook harness that signs payloads and sends real webhook headers (`X-GitHub-Event`, `X-GitHub-Delivery`, signature headers) to the ingestion endpoint.
- For determinism, keep fixture payloads/versioned transcripts in-repo and replay them in tests.
- Validate idempotency by replaying the same webhook payload multiple times.
- Validate out-of-order handling by applying newer then older updates and asserting no stale overwrite.
- Validate bootstrap behavior for repository onboarding (one job per repo via `lockKey`).
- Keep fast unit tests, but prioritize Convex-test integration coverage for core sync flows.
- Optional live smoke tests against a disposable GitHub test repo are allowed, but CI-critical tests must remain reproducible and offline-capable.

## Delivery Order

Implement in this sequence:

0. **Slice 0: Cleanup + Foundation**
   - Delete starter domain code (guestbook, posts, users schema/RPC)
   - Strip Better Auth from active schema and HTTP routes (keep packages installed)
   - Remove discord-bot references from active codepaths
   - Init git repo, make initial commit of clean state
   - Generate `GITHUB_WEBHOOK_SECRET` and add to `.env` and `.env.example`
   - Create public test repo `RhysSullivan/quickhub-test` via `gh repo create`
   - Verify `bun install` and `bun typecheck` pass on clean state
1. Control + ingestion schema (all tables via Confect `defineTable`).
2. Webhook HTTP endpoint and HMAC-SHA256 signature verification.
3. Repository connect flow + bootstrap backfill (repo metadata, branches, recent commits).
4. PR/issue/comment sync (webhook handlers + backfill).
5. Commit/branch/check-run sync (webhook handlers + backfill).
6. Projection builders (view tables updated on domain table writes).
7. UI pages wired to projections (public, no auth).
8. Replay/reconcile/dead-letter operations.

## Definition of Done

Done means:

1. A newly connected repository can be fully hydrated (bootstrapped) from zero via backfill.
2. Repo-level webhook updates are reflected in UI within seconds.
3. Failed/missed events are repairable via replay/reconcile.
4. UI does not depend on direct GitHub API reads for normal views — all reads from Convex projections.
5. Test coverage (via `@packages/convex-test`) validates schema, idempotency, and projection correctness.
6. Connecting a new repo is a single admin operation that triggers webhook creation + bootstrap automatically.

## Execution Discipline

For each vertical slice:

1. short plan,
2. implement,
3. test,
4. validate data,
5. commit locally,
6. append status notes in this file.

Proceed autonomously until the GitHub mirror is reliable, fast, and operable.

## Status Notes (Append-Only)

Use this format at the end of each work session:

```
Timestamp:
Branch:
Completed:
In Progress:
Next Step:
Next Command:
Blockers/Risks:
```

### Session: 2026-02-18

```
Timestamp: 2026-02-18
Branch: main
Completed:
  - Slice 0 fully complete and committed (5f19e4c)
  - Deleted all starter domain code (guestbook, benchmark, admin tests)
  - Deleted discord-bot app and reacord package entirely
  - Deleted betterAuth Convex component, auth.config.ts, shared/betterAuth.ts
  - Deleted old UI demos and RPC files
  - Stripped betterAuth from convex.config.ts and http.ts
  - Added 18-table GitHub mirror schema in schema.ts
  - Rewrote admin.ts with healthCheck query
  - Updated main-site with QuickHub placeholder
  - Cleaned tsconfig.json, knip.json, biome.json of stale references
  - bun typecheck passes (5/5 packages)
  - GITHUB_WEBHOOK_SECRET generated and in .env
  - Test repo RhysSullivan/quickhub-test exists on GitHub
In Progress:
  - Slice 1 schema validation (need to run Convex codegen to confirm schema compiles)
Next Step:
  - Run Convex codegen to validate the 18-table schema
  - Build Slice 2: Webhook HTTP endpoint with HMAC-SHA256 signature verification
  - Build Slice 3: Repository connect flow + bootstrap backfill
Next Command:
  - bunx convex dev (from packages/database) to validate schema
Blockers/Risks:
  - Schema.Array produces readonly T[] which conflicts with Convex GenericDataModel mutable Value[].
    This only matters for generic type constraints (betterAuth shared module, now deleted).
    Confect's schemaToValidator correctly converts Schema.Array to v.array() at runtime.
  - LSP still shows phantom errors on deleted files (stale cache). bun typecheck is source of truth.
```

### Session: 2026-02-18 (continued)

```
Timestamp: 2026-02-18T11:00
Branch: main
Completed:
  - Slice 2 complete and committed (47a6c7f)
  - Webhook HTTP endpoint at /api/github/webhook
  - HMAC-SHA256 signature verification (Web Crypto, timing-safe comparison)
  - webhookIngestion.ts: internalMutation storeRawEvent with deliveryId dedup
  - webhookVerify.ts: Effect-based signature verification with tagged errors
  - Fixed Confect: withIndex callback now typed as LooseIndexRangeBuilder (not unknown)
  - Exported LooseIndexRangeBuilder from @packages/confect and @packages/confect/ctx
  - Confect tests pass (124/124), full typecheck passes (5/5)
  - Updated PLAN.md: autonomy rules for self-editing plan and updating Confect directly
  - Added biome override for http.ts (needs _generated/server import for httpAction)
In Progress:
  - Slice 3: Repository connect flow + bootstrap backfill
Next Step:
  - Build connectRepo admin mutation (creates installation + repo records, enqueues bootstrap job)
  - Build bootstrap backfill action (fetches repo metadata, branches, PRs, issues via gh api)
  - Test with RhysSullivan/quickhub-test repo
Next Command:
  - Create packages/database/convex/rpc/repoConnect.ts
Blockers/Risks:
  - _generated/api.d.ts is stale (doesn't include webhookIngestion yet). Will be fixed on next
    Convex codegen/dev/deploy. Does not block typecheck.
  - Need to decide: use `gh api` via Convex action (requires Node runtime) or direct fetch with PAT.
    Leaning toward direct fetch since it's simpler and doesn't require gh CLI on the server.
```

### Session: 2026-02-18 (third)

```
Timestamp: 2026-02-18T11:10
Branch: main
Completed:
  - Slice 3 code complete (not yet deployed/tested end-to-end)
  - shared/githubApi.ts: GitHubApiClient Effect service with `use` pattern, Data.TaggedError, Layer.effect Default
  - rpc/repoConnect.ts: connectRepo public mutation — creates installation, repo, sync job, schedules bootstrap
  - rpc/bootstrapWrite.ts: 5 internal mutations — upsertBranches, upsertPullRequests, upsertIssues, upsertUsers, updateSyncJobState
  - rpc/repoBootstrap.ts: bootstrapRepo internal action — paginated fetch of branches/PRs/issues via GitHub REST API, user collection, batched writes (50/batch)
  - http.ts: rewritten as pure Effect pipeline with tagged errors (MissingHeaders, MissingSecret, InvalidPayload) and Effect.catchTags
  - Confect: added `scheduler: Scheduler` to ConfectMutationCtx interface and makeMutationCtx
  - Confect: fixed LooseIndexRangeBuilder — changed from type alias to self-referential interface extending IndexRange, so .eq().eq() chains work
  - Confect tests pass (124/124), full typecheck passes (5/5 packages, 0 errors)
In Progress:
  - Need to deploy to Convex to regenerate _generated/api.d.ts
  - Need to test connectRepo + bootstrapRepo end-to-end with RhysSullivan/quickhub-test
Next Step:
  - Deploy to Convex (bunx convex deploy from packages/database)
  - Call connectRepo manually with quickhub-test repo metadata
  - Verify bootstrap action runs and populates domain tables
  - Create repo-level webhook on quickhub-test via gh api
  - Begin Slice 4: webhook handlers for PR/issue/comment events
Next Command:
  - bunx convex deploy (from packages/database)
Blockers/Risks:
  - GITHUB_PAT must be set as Convex environment variable for bootstrap action to work (it reads process.env.GITHUB_PAT in action runtime)
  - _generated/api.d.ts still stale until deploy/codegen
```
