# AGENTS.md - packages/database

Local guide for autonomous agents working in `packages/database`.

## Design stance

- Treat this package as greenfield-first.
- Breaking changes are acceptable when they improve correctness and simplify design.
- Prefer end-to-end clean solutions over compatibility band-aids.

## Commands

Run from `packages/database` unless noted.

- Convex dev: `bun run dev`
- Codegen: `bun run codegen`
- Deploy (prod env): `bun run deploy`
- Typecheck (fast): `bun run typecheck`
- Typecheck (slow): `bun run typecheck:slow`
- Test all: `bun run test`
- Watch tests: `bun run test:watch`
- Single test file: `bun run test githubMirror.test.ts`
- Single test by name: `bun run test -t "test name"`
- Root-filtered run (from repo root): `bun --filter @packages/database run test githubMirror.test.ts`
- Lint (repo root): `bun run lint`

## Convex and Confect rules

- Use the new Convex function syntax with explicit `args` and `returns`.
- Always provide validators; use `v.null()` for null returns.
- Public API: `query` / `mutation` / `action`; internal API: `internal*` variants.
- Keep schema definitions in `convex/schema.ts`.
- Index naming should include all fields (for example `by_repoId_and_number`).
- Do not use query `filter`; add indexes and use `withIndex`.
- Repo-specific architecture rule: avoid cross-function calls (`ctx.runQuery`, `ctx.runMutation`, `ctx.runAction`) between Convex functions.
- Extract shared logic into `convex/shared/*.ts`; call that from wrappers.
- Exception: actions can use `ctx.runQuery` where runtime constraints require it.
- In Node-runtime actions, add `"use node"` at file top.

## Type and import style

- Do not use `any`, `unknown`, or type assertions.
- Prefer type inference unless explicit types improve clarity.
- Keep strict typing for IDs (`Id<"table">`).
- Cross-package imports must use aliases (for example `@packages/confect`).
- Inside this package, do not self-import `@packages/database`; use relative imports.
- Respect Biome restricted import rules around `_generated/server` usage.

## Effect style

- Prefer Effect modules over ad hoc async/imperative patterns.
- Alias Effect modules that shadow globals (`Array as Arr`, `Number as Num`, `String as Str`).
- Prefer `Option`/`Either`/tagged errors for recoverable failures.
- Prefer dependency access via `yield* ServiceTag`.

## Rule sources to honor

- Root agent guide: `/home/rhys/quickhub/AGENTS.md`.
- Cursor rules exist in `/home/rhys/quickhub/.cursor/rules/*.mdc` and are mandatory.
- No `.cursorrules` file exists.
- No `.github/copilot-instructions.md` file exists.
