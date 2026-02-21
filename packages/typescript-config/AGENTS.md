# AGENTS.md - packages/typescript-config

Local guide for autonomous agents working in `packages/typescript-config`.

## Design stance

- Treat this package as greenfield-first.
- Breaking changes are acceptable when they simplify workspace TS configuration.
- Prefer clean shared config design over preserving legacy config quirks.

## Commands

Run from `packages/typescript-config` unless noted.

- Typecheck: `bun run typecheck` (currently a placeholder script)
- Lint (repo root): `bun run lint`
- Build (repo root): `bun run build`

This package currently has no local test script.
If tests are added, prefer Vitest and document single-file invocation.

## Code style

- Formatting/linting are governed by root `biome.json`.
- Keep config exports small, explicit, and well-named.
- Prefer strict defaults and avoid surprising compiler behavior.
- Use Bun workflows only.

## Rule sources to honor

- Root agent guide: `/home/rhys/quickhub/AGENTS.md`.
- Cursor rules exist in `/home/rhys/quickhub/.cursor/rules/*.mdc` and are mandatory.
- No `.cursorrules` file exists.
- No `.github/copilot-instructions.md` file exists.
