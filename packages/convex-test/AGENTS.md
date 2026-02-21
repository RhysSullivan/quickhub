# AGENTS.md - packages/convex-test

Local guide for autonomous agents working in `packages/convex-test`.

## Design stance

- Treat this package as greenfield-first.
- Breaking changes are acceptable when they improve test harness correctness.
- Prefer best long-term behavior parity with Convex semantics.

## Commands

Run from `packages/convex-test` unless noted.

- Typecheck: `bun run typecheck`
- Test all: `bun run test`
- Watch tests: `bun run test:watch`
- Run once alias: `bun run test:once`
- Single test file: `bun run test convex/actions.test.ts`
- Single test by name: `bun run test -t "test name"`
- Debug tests: `bun run test:debug`
- Coverage: `bun run test:coverage`
- Root-filtered run (from repo root): `bun --filter @packages/convex-test run test convex/actions.test.ts`
- Lint (repo root): `bun run lint`

## Code style

- Formatting/linting are governed by root `biome.json`.
- Favor strict typing in new code.
- Avoid introducing new `any`/`unknown`/casts; legacy internals may contain historical exceptions.
- Keep mock behavior aligned with real Convex query/mutation/action semantics.

## Convex-specific notes

- Prefer explicit validators and schema-driven behavior in fixtures.
- Index and query semantics should match Convex behavior as closely as possible.
- Keep tests deterministic and isolate side effects.

## Rule sources to honor

- Root agent guide: `/home/rhys/quickhub/AGENTS.md`.
- Cursor rules exist in `/home/rhys/quickhub/.cursor/rules/*.mdc` and are mandatory.
- No `.cursorrules` file exists.
- No `.github/copilot-instructions.md` file exists.
