---
alwaysApply: true
---

# Code Style & Architecture Preferences

## Type Safety

- Never use `any`, `unknown`, or TypeScript type casting (`as` or angle bracket syntax)
- Use proper types and type inference instead
- **Prefer type inference over manual type annotations** - if TypeScript can infer the type, let it infer rather than adding explicit annotations

## Database Design

- Use regular boolean fields instead of bitfield encoding/decoding
- Store settings in separate tables rather than embedding flags in main entities
- All database operations should flow through the database service layer

## Testing

- Tests should use the same patterns as production code (database service layer)
- Include tests in implementation plans and run them during development (`bun run test`)
- Keep test code clean and straightforward

## Code Quality

- Prefer type inference; only add explicit types when necessary for clarity or when inference isn't sufficient
- Prefer clear separation of concerns
- Avoid test-specific workarounds or shortcuts

## UI Components

- **Always prefer components from `@packages/ui` over native HTML elements**
- Use `<Button />` instead of `<button />`
- Use `<Input />` instead of `<input />`
- Use `<Textarea />` instead of `<textarea />`
- Use `<Label />` instead of `<label />`
- Use `<Select />` instead of `<select />`
- Use `<Checkbox />` instead of `<input type="checkbox" />`
- Use `<Link />` instead of `<a />` for navigation
- Import components from `@packages/ui/components/*` (e.g., `import { Button } from "@packages/ui/components/button"`)
- Only use native HTML elements when there is no equivalent component in `@packages/ui`

## Typecheck

- **Do NOT run `bun typecheck` after every change** - it's slow and wasteful
- Only run typecheck when:
  - Done making a set of changes
  - Verifying work is complete
  - Debugging type errors
- During active development, rely on IDE type checking and only run the full typecheck at checkpoints

## Dev Server

- Do not run the dev server unless explicitly instructed
