# AGENTS.md - packages/observability

Local guide for autonomous agents working in `packages/observability`.

## Design stance

- Treat this package as greenfield-first.
- Breaking changes are acceptable when they simplify telemetry APIs and improve reliability.
- Prefer best long-term design over compatibility shims.

## Commands

Run from `packages/observability` unless noted.

- Test all: `bun run test`
- Watch tests: `bun run test:watch`
- Single test file: `bun run test src/json-exporter.test.ts`
- Single test by name: `bun run test -t "test name"`
- Root-filtered run (from repo root): `bun --filter @packages/observability run test src/json-exporter.test.ts`
- Lint (repo root): `bun run lint`
- Typecheck (repo root): `bun run typecheck`

## Code style

- Formatting/linting are governed by root `biome.json`.
- Do not use `any`, `unknown`, or type assertions.
- Prefer inference over unnecessary annotations.
- Prefer Effect modules and typed error handling patterns.
- Keep instrumentation behavior deterministic and testable.

## Tests

- Vitest environment: `node`.
- Default timeout in this package is 10s.

## Rule sources to honor

- Root agent guide: `/home/rhys/quickhub/AGENTS.md`.
- Cursor rules exist in `/home/rhys/quickhub/.cursor/rules/*.mdc` and are mandatory.
- No `.cursorrules` file exists.
- No `.github/copilot-instructions.md` file exists.
