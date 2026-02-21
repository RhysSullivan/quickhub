# AGENTS.md - QuickHub Monorepo Guide

This file is for autonomous coding agents working in `/home/rhys/quickhub`.
It defines build/test/lint commands, style conventions, and repository-specific rules.

## Scope and decision policy

- Treat this codebase as **greenfield-first** when proposing changes.
- Prefer the **best long-term design** over backwards compatibility.
- Breaking changes are acceptable when they simplify architecture or improve correctness.
- Keep changes cohesive: avoid partial band-aids when a cleaner end-to-end refactor is possible.

## Workspace basics

- Package manager: `bun` only.
- Monorepo task runner: `turbo`.
- Lint/format tool: `biome`.
- Main technologies: Effect, Convex, Confect, Next.js 16, React 19, Vitest.

## Common commands (repo root)

- Install deps: `bun install`
- Dev (all packages): `bun dev`
- Build all: `bun run build`
- Typecheck (fast, preferred): `bun run typecheck`
- Typecheck (slow): `bun run typecheck:slow`
- Lint: `bun run lint`
- Lint + auto-fix: `bun run lint:fix`
- Test all (except `@packages/convex-test`): `bun run test`
- CI equivalent: `bun run ci`

## Running tests (including single tests)

Use Vitest args after `bun run test` in the target package.

- Single file (generic): `bun run test path/to/file.test.ts`
- Single test by name: `bun run test -t "test name"`
- Watch mode: `bun run test:watch`

From repo root with workspace filter:

- Database file: `bun --filter @packages/database run test githubMirror.test.ts`
- UI file: `bun --filter @packages/ui run test src/components/command.test.tsx`
- Main site file: `bun --filter @packages/main-site run test src/app/(main-site)/_components/search-command-dsl.test.ts`
- Confect file: `bun --filter @packages/confect run test src/rpc/server.test.ts`
- Observability file: `bun --filter @packages/observability run test src/json-exporter.test.ts`
- Convex-test file: `bun --filter @packages/convex-test run test convex/actions.test.ts`

## Formatting and linting

- Biome is authoritative (`biome.json`).
- Indentation: tabs.
- Quotes in JS/TS: double quotes.
- Run formatting/lint fixes via Biome; do not introduce a second formatter.

## TypeScript rules

- Do not use `any`, `unknown`, or type assertions (`as`, angle-bracket casts).
- Prefer inference over explicit types unless clarity requires annotation.
- Keep strict typing around IDs, especially Convex IDs (`Id<"table">`).
- Avoid non-null assertions unless already accepted in test code.

## Imports and module boundaries

- Cross-package imports must use package aliases (for example `@packages/database`).
- Do not use deep relative paths across packages.
- Do not self-import package entrypoints from within that same package.
  - In `packages/ui`, do not import from `@packages/ui` internally.
  - In `packages/database`, do not import from `@packages/database` internally.
- In `packages/database`, prefer `./client` or `../client` abstractions where enforced, not direct `_generated/server` imports in restricted paths.

## Effect conventions

- Prefer Effect primitives and modules over ad hoc JS patterns when practical.
- Alias Effect modules that shadow JS globals:
  - `Array as Arr`, `Number as Num`, `String as Str`, `BigInt as BigIntEffect`.
- Prefer `yield* ServiceTag` dependency access over passing services through function args.
- Prefer `Option`/`Either`/tagged errors for recoverable failures.

## Convex and Confect conventions

- Use new Convex function syntax with explicit `args` and `returns` validators.
- Use `v.null()` when returning null.
- Use `query`/`mutation`/`action` for public API, `internal*` for private API.
- Keep schema definitions in `convex/schema.ts` and use clear index naming (`by_a_and_b`).
- Do not use query `filter`; prefer `withIndex`.
- In this repo, avoid cross-function calls with `ctx.runQuery`/`ctx.runMutation`/`ctx.runAction`.
  - Extract shared logic into `shared.ts` helpers.
  - Exception: actions may use `ctx.runQuery` when runtime constraints require it.

## React and UI conventions

- Prefer UI primitives from `@packages/ui/components/*` over raw HTML controls.
- Use inline event handlers when clearer; avoid vague handler names.
- Avoid unnecessary `useMemo`; use it only for measured/render-critical cases.
- Avoid clickable non-interactive elements like `<div onClick>`.
- When an effect callback should read latest state without re-triggering effect, prefer `useEffectEvent` (React 19).

## Next.js and URL state

- In Next.js app code, prefer `nuqs` for URL query state over `useSearchParams`.
- For Next.js 16 request interception, use `proxy.ts` (renamed from middleware).

## Testing guidelines

- Write tests using production architecture paths (especially database service layers).
- Keep tests straightforward; avoid test-only hacks in production code.
- Run focused tests during development; run broader suites before finishing.

## Operational guidance for agents

- Do not run long-lived dev servers unless explicitly requested.
- Do not run full typecheck after every edit; run at logical checkpoints.
- Prefer non-destructive commands; ask before destructive operations.
- Recommended command timeouts:
  - quick checks: 30s
  - lint/test/build default: 60s
  - large suites/builds: 120-300s

## External context repositories

- Reference implementations are under `.context/`:
  - `effect`, `better-auth`, `convex-backend`, `convex-js`, `effect-atom`, `vercel-ai`, `ai-elements`.

## Cursor and Copilot rules status

- Cursor rules are present in `.cursor/rules/*.mdc` and are mandatory for this repo.
- No `.cursorrules` file found.
- No `.github/copilot-instructions.md` file found.

Cursor rule files currently present:

- `.cursor/rules/always-use-bun.mdc`
- `.cursor/rules/bash-powers.mdc`
- `.cursor/rules/clone-repos-to-tmp.mdc`
- `.cursor/rules/command-timeout.mdc`
- `.cursor/rules/confect-effect-atom.mdc`
- `.cursor/rules/convex-tips.mdc`
- `.cursor/rules/convex_rules.mdc`
- `.cursor/rules/effect-dependency-injection.mdc`
- `.cursor/rules/effect-mpc.mdc`
- `.cursor/rules/effect-primitives.mdc`
- `.cursor/rules/import-rules.mdc`
- `.cursor/rules/never-use-as-any.mdc`
- `.cursor/rules/nextjs-proxy.mdc`
- `.cursor/rules/nuqs-url-state.mdc`
- `.cursor/rules/preferences.mdc`
- `.cursor/rules/react-red-flags.mdc`
- `.cursor/rules/subagent-context.mdc`
- `.cursor/rules/take-notes.mdc`
- `.cursor/rules/use-effect-event.mdc`
- `.cursor/rules/vendored-repos.mdc`

## Key Cursor rule themes captured here

- Bun-only workflows.
- Strict TS safety (no `any`/`unknown`/casts).
- Effect-first primitives and DI via `yield*`.
- Convex schema/function/index validation discipline.
- No cross-package relative imports and no self package imports.
- Prefer `nuqs` for URL state in `apps/main-site` and `packages/ui`.
- Keep notes in `personal-notes/` when useful during exploration.
- When cloning external repos from URLs, clone into `/tmp/<repo>`.
