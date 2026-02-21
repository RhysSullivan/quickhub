# AGENTS.md - packages/confect

Local guide for autonomous agents working in `packages/confect`.

## Design stance

- Treat this package as greenfield-first.
- Breaking changes are acceptable when they improve API correctness and ergonomics.
- Prefer best long-term RPC architecture over backwards-compatible workarounds.

## Commands

Run from `packages/confect` unless noted.

- Test all: `bun run test`
- Watch tests: `bun run test:watch`
- Single test file: `bun run test src/rpc/server.test.ts`
- Single test by name: `bun run test -t "test name"`
- Root-filtered run (from repo root): `bun --filter @packages/confect run test src/rpc/server.test.ts`
- Lint (repo root): `bun run lint`
- Typecheck (repo root): `bun run typecheck`

## Code style

- Formatting/linting are governed by root `biome.json`.
- Do not use `any`, `unknown`, or type assertions.
- Prefer type inference where clear.
- Prefer Effect-first architecture and typed schemas.
- Prefer dependency access via `yield* ServiceTag` in Effect code.
- Use tagged errors / `Either` / `Option` for recoverable failures.
- Keep API surfaces strongly typed and schema-driven.

## Imports and boundaries

- Use workspace aliases for cross-package imports.
- Keep modules cohesive; avoid circular RPC type dependencies where possible.

## Tests

- Vitest environment: `node`.
- Benchmarks are configured for `**/*.bench.ts`.

## Rule sources to honor

- Root agent guide: `/home/rhys/quickhub/AGENTS.md`.
- Cursor rules exist in `/home/rhys/quickhub/.cursor/rules/*.mdc` and are mandatory.
- No `.cursorrules` file exists.
- No `.github/copilot-instructions.md` file exists.
