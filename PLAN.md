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

## Product Objective

Build a GitHub mirror system where:

1. GitHub webhooks stream incremental updates into Convex.
2. Backfill jobs pull historical data from GitHub into Convex.
3. Reconciliation jobs repair missed or out-of-order changes.
4. One-time repository bootstrap sync runs automatically when new repositories are added.
5. The UI reads from Convex projections only for fast, stable page loads.

## Autonomy Rules

1. Work in small vertical slices: schema -> sync -> projection -> UI -> tests.
2. Commit frequently with clear messages.
3. Use GitHub CLI (`gh`) for GitHub operations.
4. Use Convex CLI for deploy/run/log/sync operations.
5. Prefer idempotent and replay-safe behavior over shortcuts.
6. Assume webhook events can be delayed, duplicated, or out-of-order.
7. Keep the repo in a runnable state after each slice.
8. This plan is a guide, not a prison; if a better path appears, take it and update this file with the rationale.

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
  - `installationId: number`
  - `accountId: number`
  - `accountLogin: string`
  - `accountType: "User" | "Organization"`
  - `suspendedAt: number | null`
  - `permissionsDigest: string`
  - `eventsDigest: string`
  - `updatedAt: number`
  - indexes:
    - `by_installationId`
    - `by_accountLogin`

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

1. Trigger repository bootstrap sync when receiving:
   - `installation_repositories` with `repositories_added`
   - `repository.created`
   - `repository.transferred`
   - app installation initial repository list
2. Enqueue one repository-scoped backfill job per repo using deterministic `lockKey`.
3. If a queued/running bootstrap already exists for the same repo, do not create duplicates.
4. Bootstrap pipeline for each repo must fetch at minimum:
   - repository metadata
   - default branch + branch heads
   - recent commits window
   - pull requests
   - issues + issue comments
   - check runs for active PR head SHAs
5. Mark repo as `bootstrapCompleteAt` once minimum dataset is written.
6. After bootstrap complete, repo transitions to normal webhook + reconcile flow.
7. If bootstrap fails, retry with backoff; after retry exhaustion, move to dead-letter + alert.
8. Support manual bootstrap retry command for a single repo.

## GitHub CLI Instructions

Use `gh` and `gh api` for setup and operations.

Core commands:

- auth/context:
  - `gh auth status`
  - `gh repo view <owner>/<repo>`
- webhook list:
  - `gh api /repos/<owner>/<repo>/hooks`
- webhook create (example):
  - `gh api --method POST /repos/<owner>/<repo>/hooks -f name=web -f active=true -f events[]=push -f events[]=pull_request -f events[]=issues -f events[]=issue_comment -f events[]=check_run -f config.url='<convex-webhook-url>' -f config.content_type=json -f config.secret='<webhook-secret>'`
- deliveries:
  - `gh api /repos/<owner>/<repo>/hooks/<hook_id>/deliveries`
- redeliver:
  - `gh api --method POST /repos/<owner>/<repo>/hooks/<hook_id>/deliveries/<delivery_id>/attempts`

Backfill guidance:

- Use GraphQL (`gh api graphql --paginate`) where page traversal is cleaner.
- Use REST for webhook-aligned entities and simpler payload mapping.

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

1. Control + ingestion schema.
2. Webhook endpoint and signature verification.
3. Repository/user/org backfill.
4. PR/issue/comment sync.
5. Commit/branch/check-run sync.
6. Projection builders.
7. UI pages wired to projections.
8. Replay/reconcile/dead-letter operations.

## Definition of Done

Done means:

1. New installation can be fully hydrated from zero.
2. Webhook updates are reflected in UI quickly.
3. Failed/missed events are repairable via replay/reconcile.
4. UI does not depend on direct GitHub reads for normal views.
5. Test coverage validates schema, idempotency, and projection correctness.

## Execution Discipline

For each vertical slice:

1. short plan,
2. implement,
3. test,
4. validate data,
5. commit,
6. push/update PR,
7. append status notes in this file.

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
