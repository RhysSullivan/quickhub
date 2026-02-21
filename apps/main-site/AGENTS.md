# AGENTS.md - apps/main-site

Local guide for autonomous agents working in `apps/main-site`.

## Design stance

- Treat this app as greenfield-first.
- Breaking changes are acceptable when they produce a cleaner long-term design.
- Prefer best architecture over temporary backwards-compatibility shims.

## Commands

Run from `apps/main-site` unless noted.

- Install deps (repo root): `bun install`
- Dev server: `bun run dev`
- Build: `bun run build`
- Typecheck (fast): `bun run typecheck`
- Typecheck (slow): `bun run typecheck:slow`
- Test all in this app: `bun run test`
- Single test file: `bun run test src/app/(main-site)/_components/search-command-dsl.test.ts`
- Single test by name: `bun run test -t "parses provider, target, and author"`
- Lint (repo root): `bun run lint`
- Lint fix (repo root): `bun run lint:fix`

## Code style and architecture

- Formatting and linting come from root `biome.json` (tabs + double quotes).
- Use package imports for cross-package boundaries (for example `@packages/ui`).
- Do not use `any`, `unknown`, or type assertions.
- Prefer type inference over explicit annotations when clear.
- Prefer Effect primitives and helpers where practical.
- Prefer `yield* ServiceTag` dependency access in Effect code.
- For URL state, use `nuqs` (not `useSearchParams`).
- In Next.js 16+, request interception belongs in `proxy.ts`.
- Prefer shared UI primitives from `@packages/ui/components/*` over raw HTML controls.
- Avoid `<div onClick>`; use semantic interactive elements.
- Prefer inline event handlers when clearer than generic handler names.
- Use `useEffectEvent` when effect callbacks need latest props/state without retriggering.

## Data fetching and Suspense boundaries

- **Never use `use()` to unwrap server Promises** — always `await` data on the server so it is properly prefetched and SSR'd.
- **Suspense boundaries must be as close as possible to where data is used, not where it is fetched.** Static layout (backgrounds, grids, headings) must render immediately outside any Suspense boundary.
- **Each data-dependent section gets its own async server component + `<Suspense>`**, even when multiple sections consume the same query. The confect server query cache deduplicates concurrent `queryPromise` calls with the same payload and auth scope into a single HTTP request.
- **Do not prop-drill fetched data through component trees.** Instead of one parent fetching data and passing slices to children, each child section should have its own async server wrapper that fetches (deduped) and passes only the data that specific client component needs.
- **Client components receive resolved `initialData`, not Promises.** They call `useSubscriptionWithInitial(atom, initialData)` for real-time updates after hydration.
- Pattern:
  ```
  page.tsx (server, renders immediately)
  ├── Static shell (layout, headings, grid) — no Suspense
  ├── <Suspense fallback={<SectionSkeleton />}>
  │   └── SectionContent (async server — awaits data)
  │       └── SectionClient (client — receives initialData, subscribes)
  ├── <Suspense fallback={<OtherSkeleton />}>
  │   └── OtherContent (async server — awaits same deduped query)
  │       └── OtherClient (client — receives initialData, subscribes)
  ```

## Tests

- Vitest environment: `happy-dom`.
- Favor targeted test runs while iterating; broaden before finishing.

## Rule sources to honor

- Root agent guide: `/home/rhys/quickhub/AGENTS.md`.
- Cursor rules exist in `/home/rhys/quickhub/.cursor/rules/*.mdc` and are mandatory.
- No `.cursorrules` file exists.
- No `.github/copilot-instructions.md` file exists.
