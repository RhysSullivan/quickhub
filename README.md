# create-epoch-app

An opinionated starter template for building full-stack applications with **Effect**, **Convex**, and **Next.js**.

e - effect

p - posthog

o - otel

c - convex

h - help me find something with h to cram in here

## What's Included

### Apps

- **`apps/main-site`** - Next.js 15 app with App Router, Tailwind CSS, and shadcn/ui components
- **`apps/discord-bot`** - Discord bot built with Effect and Reacord (React for Discord)

### Packages

- **`packages/confect`** - Effect + Convex integration layer with type-safe schemas and handlers
- **`packages/database`** - Convex backend with Better Auth integration
- **`packages/ui`** - Shared React components built on Radix UI and Tailwind
- **`packages/reacord`** - React renderer for Discord embeds and interactions
- **`packages/observability`** - Sentry and OpenTelemetry integration for Effect
- **`packages/convex-test`** - Testing utilities for Convex functions

## Tech Stack

- **[Effect](https://effect.website)** - Type-safe functional programming
- **[Convex](https://convex.dev)** - Backend-as-a-service with real-time sync
- **[Next.js 15](https://nextjs.org)** - React framework with App Router
- **[Better Auth](https://better-auth.com)** - Authentication for Convex
- **[Tailwind CSS](https://tailwindcss.com)** - Utility-first CSS
- **[Radix UI](https://radix-ui.com)** - Headless UI primitives
- **[Discord.js](https://discord.js.org)** - Discord API wrapper
- **[Turbo](https://turbo.build)** - Monorepo build system
- **[Biome](https://biomejs.dev)** - Fast linter and formatter

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Node.js](https://nodejs.org) >= 18
- A [Convex](https://convex.dev) account

### Setup

1. Clone the repository:

```bash
git clone https://github.com/your-username/create-epoch-app.git
cd create-epoch-app
```

2. Install dependencies:

```bash
bun install
```

3. Copy the environment file and configure it:

```bash
cp .env.example .env
```

4. Set up Convex:

```bash
cd packages/database
bunx convex dev
```

5. Start development:

```bash
bun dev
```

This starts:

- Next.js app at http://localhost:3000
- Discord bot (if configured)
- Convex dev server

## Project Structure

```
├── apps/
│   ├── discord-bot/     # Discord bot with Effect + Reacord
│   └── main-site/       # Next.js frontend
├── packages/
│   ├── confect/         # Effect + Convex integration
│   ├── convex-test/     # Convex testing utilities
│   ├── database/        # Convex backend + auth
│   ├── observability/   # Sentry + OpenTelemetry
│   ├── reacord/         # React for Discord
│   └── ui/              # Shared UI components
└── scripts/             # Build and setup scripts
```

## Key Patterns

### Effect + Convex (Confect RPC)

The `confect` package provides type-safe Convex RPC functions with Effect:

```typescript
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Schema } from "effect";
import { ConfectMutationCtx, confectSchema } from "../confect";

const factory = createRpcFactory({ schema: confectSchema });

export const postsModule = makeRpcModule({
  create: factory.mutation(
    { payload: { title: Schema.String }, success: Schema.String },
    (args) =>
      Effect.gen(function* () {
        const ctx = yield* ConfectMutationCtx;
        const id = yield* ctx.db.insert("posts", { title: args.title });
        return id;
      }),
  ),
});
```

### Discord Bot with Reacord

Build Discord UIs with React components:

```tsx
import { Button, Container } from "@packages/reacord";

function WelcomeMessage({ username }: { username: string }) {
  return (
    <Container>
      <h1>Welcome, {username}!</h1>
      <Button label="Get Started" onClick={() => console.log("clicked")} />
    </Container>
  );
}
```

### Better Auth Integration

Authentication is pre-configured with Better Auth for Convex:

```typescript
import { useSession } from "@packages/ui/components/convex-client-provider";

function Profile() {
  const { data: session } = useSession();
  if (!session) return <SignInButton />;
  return <div>Hello, {session.user.name}</div>;
}
```

## Scripts

```bash
bun dev          # Start all apps in development
bun build        # Build all packages
bun typecheck    # Type check all packages
bun test         # Run tests
bun test:otel:e2e # Run OTEL frontend+backend verification tests
bun run test:otel:convex:local # Run OTEL smoke test against local Convex backend
bun run otel:process:console # Parse OTEL console span logs from stdin
bun lint         # Lint with Biome
bun lint:fix     # Fix lint issues
```

## OpenTelemetry Verification

The repo includes end-to-end OTEL tracing tests that verify frontend and Convex spans are linked by trace and parent span IDs.

Run the full OTEL verification suite:

```bash
bun test:otel:e2e
```

Run the local Convex smoke test (starts a self-hosted backend container):

```bash
bun run test:otel:convex:local
```

This smoke test starts a local self-hosted Convex backend from the official image, deploys this repo's Convex functions into it, performs a mutation + query, and verifies server OTEL span logs from container output.

Prerequisites:

- Docker is installed and running
- Internet access to pull `ghcr.io/get-convex/convex-backend:latest`

Optional overrides:

- `CONVEX_LOCAL_KEEP_CONTAINER=true` to keep the backend running after the test
- `CONVEX_LOCAL_BACKEND_PORT` / `CONVEX_LOCAL_SITE_PROXY_PORT` to change ports
- `CONVEX_LOCAL_IMAGE` to pin a specific backend image tag

If you want a quick summary of JSON console span logs, pipe test output to the processor:

```bash
bun run --filter @packages/ui test -- otel-tracing.test.tsx 2>&1 | bun run otel:process:console
```

You can disable payload-based telemetry context fallback (while keeping header-based propagation) with:

```bash
NEXT_PUBLIC_CONVEX_OTEL_PAYLOAD_FALLBACK=false
```

When payload fallback is enabled, query payloads also include trace context metadata, which can reduce Convex query dedupe/cache effectiveness for identical logical queries.

## License

[FSL-1.1-MIT](LICENSE.md) - Functional Source License with MIT future license.
