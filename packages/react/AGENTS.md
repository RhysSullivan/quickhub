# AGENTS.md - packages/react

Local guide for autonomous agents working in `packages/react`.

## Design stance

- Treat this package as greenfield-first.
- Breaking changes are acceptable when they improve API shape and maintainability.
- Prefer best long-term React/Effect integration patterns.

## Commands

Run from `packages/react` unless noted.

- Typecheck: `bun run typecheck`
- Lint (repo root): `bun run lint`
- Build (repo root): `bun run build`

This package currently has no local `test` script.
When adding tests, use Vitest and keep command patterns consistent with other packages.

## Code style

- Formatting/linting are governed by root `biome.json`.
- Do not use `any`, `unknown`, or type assertions.
- Prefer type inference over verbose annotations.
- Prefer Effect-first patterns where practical.
- Keep React API surfaces composable and strongly typed.

## Imports and boundaries

- Use workspace aliases for cross-package imports.
- Keep package exports explicit in `package.json` and `src/index.ts`.

## Rule sources to honor

- Root agent guide: `/home/rhys/quickhub/AGENTS.md`.
- Cursor rules exist in `/home/rhys/quickhub/.cursor/rules/*.mdc` and are mandatory.
- No `.cursorrules` file exists.
- No `.github/copilot-instructions.md` file exists.
