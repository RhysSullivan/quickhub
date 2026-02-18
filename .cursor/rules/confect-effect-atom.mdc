---
description: Confect (Effect + Convex) and Effect-Atom patterns for type-safe RPC and reactive state management
globs: packages/database/convex/**/*.ts,packages/ui/**/*.ts,packages/ui/**/*.tsx,apps/main-site/**/*.tsx,apps/discord-bot/**/*.ts
alwaysApply: false
---

# Confect & Effect-Atom Patterns

This codebase uses **Confect** (`@packages/confect`) for Effect + Convex integration and **Effect-Atom** (`@effect-atom/atom`) for reactive state management in React.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        React Components                      │
│  useAtomValue(atom) / useAtom(atom) / usePaginatedAtom()   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    RPC Client (effect-atom)                  │
│  guestbookClient.list.subscription({})                      │
│  guestbookClient.add.mutate                                  │
│  guestbookClient.listPaginated.paginated(pageSize)          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Convex Functions (RPC)                    │
│  factory.query / factory.mutation / factory.action          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Confect Context (Effect)                    │
│  ConfectQueryCtx / ConfectMutationCtx / ConfectActionCtx    │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 1: Confect (Backend - Convex Functions)

### 1.1 Schema Definition

Use Effect Schema with Confect's `defineTable` and `defineSchema`:

```typescript
// packages/database/convex/schema.ts
import { defineSchema, defineTable } from "@packages/confect/schema";
import { Schema } from "effect";

const UserSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
});

const PostSchema = Schema.Struct({
  title: Schema.String,
  content: Schema.String,
  authorId: Schema.String,
  published: Schema.Boolean,
});

export const confectSchema = defineSchema({
  users: defineTable(UserSchema).index("by_email", ["email"]),
  posts: defineTable(PostSchema)
    .index("by_authorId", ["authorId"])
    .index("by_published", ["published"]),
});

export default confectSchema.convexSchemaDefinition;
```

### 1.2 Context Setup

Create typed context tags for your schema:

```typescript
// packages/database/convex/confect.ts
import {
  ConfectMutationCtx as ConfectMutationCtxTag,
  type ConfectMutationCtx as ConfectMutationCtxType,
  ConfectQueryCtx as ConfectQueryCtxTag,
  type ConfectQueryCtx as ConfectQueryCtxType,
  ConfectActionCtx as ConfectActionCtxTag,
  type ConfectActionCtx as ConfectActionCtxType,
} from "@packages/confect/ctx";
import { type TablesFromSchemaDefinition } from "@packages/confect/schema";
import { confectSchema } from "./schema";

export { confectSchema };

type Tables = TablesFromSchemaDefinition<typeof confectSchema>;

export const ConfectQueryCtx = ConfectQueryCtxTag<Tables>();
export type ConfectQueryCtx = ConfectQueryCtxType<Tables>;

export const ConfectMutationCtx = ConfectMutationCtxTag<Tables>();
export type ConfectMutationCtx = ConfectMutationCtxType<Tables>;

export const ConfectActionCtx = ConfectActionCtxTag<Tables>();
export type ConfectActionCtx = ConfectActionCtxType<Tables>;
```

### 1.3 RPC Module Definition

Define type-safe RPC endpoints with Effect:

```typescript
// packages/database/convex/rpc/guestbook.ts
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import {
  Cursor,
  PaginationOptionsSchema,
  PaginationResultSchema,
} from "@packages/confect";
import { Effect, Schema } from "effect";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";

const factory = createRpcFactory({ schema: confectSchema });

const Entry = Schema.Struct({
  _id: Schema.String,
  _creationTime: Schema.Number,
  name: Schema.String,
  message: Schema.String,
});

class EmptyFieldError extends Schema.TaggedError<EmptyFieldError>()(
  "EmptyFieldError",
  { field: Schema.String },
) {}

const guestbookModule = makeRpcModule({
  list: factory.query({ success: Schema.Array(Entry) }, () =>
    Effect.gen(function* () {
      const ctx = yield* ConfectQueryCtx;
      const entries = yield* ctx.db.query("guestbook").order("desc").take(50);
      return entries.map((e) => ({
        _id: String(e._id),
        _creationTime: e._creationTime,
        name: e.name,
        message: e.message,
      }));
    }),
  ),

  listPaginated: factory.query(
    {
      payload: PaginationOptionsSchema.fields,
      success: PaginationResultSchema(Entry),
    },
    (args) =>
      Effect.gen(function* () {
        const ctx = yield* ConfectQueryCtx;
        const result = yield* ctx.db.query("guestbook").order("desc").paginate({
          cursor: args.cursor,
          numItems: args.numItems,
        });
        return {
          page: result.page.map((e) => ({
            _id: String(e._id),
            _creationTime: e._creationTime,
            name: e.name,
            message: e.message,
          })),
          isDone: result.isDone,
          continueCursor: Cursor.make(result.continueCursor),
        };
      }),
  ),

  add: factory.mutation(
    {
      payload: {
        name: Schema.String,
        message: Schema.String,
      },
      success: Schema.String,
      error: EmptyFieldError,
    },
    (args) =>
      Effect.gen(function* () {
        const name = args.name.trim();
        const message = args.message.trim();

        if (name.length === 0) {
          return yield* new EmptyFieldError({ field: "name" });
        }
        if (message.length === 0) {
          return yield* new EmptyFieldError({ field: "message" });
        }

        const ctx = yield* ConfectMutationCtx;
        const id = yield* ctx.db.insert("guestbook", { name, message });
        return String(id);
      }),
  ),
});

export const { list, listPaginated, add } = guestbookModule.handlers;
export { guestbookModule, EmptyFieldError };
export type GuestbookModule = typeof guestbookModule;
```

### 1.4 RPC Endpoint Types

| Method | Description | Context | Use Case |
|--------|-------------|---------|----------|
| `factory.query` | Read-only queries | `ConfectQueryCtx` | Fetching data, subscriptions |
| `factory.mutation` | Write operations | `ConfectMutationCtx` | Creating, updating, deleting |
| `factory.action` | Side effects | `ConfectActionCtx` | External APIs, background jobs |
| `factory.internalQuery` | Internal queries | `ConfectQueryCtx` | Server-to-server calls |
| `factory.internalMutation` | Internal mutations | `ConfectMutationCtx` | Scheduled jobs |
| `factory.internalAction` | Internal actions | `ConfectActionCtx` | Background processing |

### 1.5 Database Operations

Confect wraps Convex database operations with Effect:

```typescript
Effect.gen(function* () {
  const ctx = yield* ConfectQueryCtx;
  
  // Query with index
  const users = yield* ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", "test@example.com"))
    .collect();
  
  // Get by ID
  const userOption = yield* ctx.db.get(userId);
  
  // First/unique
  const firstUser = yield* ctx.db.query("users").first();
  const uniqueUser = yield* ctx.db.query("users").withIndex(...).unique();
  
  // Pagination
  const result = yield* ctx.db.query("users").paginate({
    cursor: args.cursor,
    numItems: args.numItems,
  });
});
```

---

## Part 2: Effect-Atom (Frontend - React Integration)

### 2.1 RPC Client Setup

Create a client from your RPC module:

```typescript
// packages/ui/src/rpc/guestbook.ts
"use client";

import { createRpcClient, type RpcModuleClient } from "@packages/confect/rpc";
import { api } from "@packages/database/convex/_generated/api";
import type { GuestbookModule } from "@packages/database/convex/rpc/guestbook";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export const guestbookClient = createRpcClient<GuestbookModule>(
  api.rpc.guestbook,
  { url: CONVEX_URL },
);
```

### 2.2 Atom Runtime Setup

The atom runtime is set up in the Convex client provider:

```typescript
// packages/ui/src/components/convex-client-provider.tsx
import { Atom, RegistryProvider } from "@effect-atom/atom-react";
import { ConvexClient } from "@packages/confect/client";
import { Layer } from "effect";

const AppConvexClientLayer = Layer.succeed(ConvexClient, convexClientService);
export const atomRuntime = Atom.runtime(AppConvexClientLayer);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <RegistryProvider>
      {children}
    </RegistryProvider>
  );
}
```

### 2.3 Client API Methods

Each RPC endpoint exposes different methods based on its type:

| Endpoint Type | Client Methods | Atom Type |
|---------------|---------------|-----------|
| Query | `.query(payload)`, `.subscription(payload)`, `.paginated(numItems)` | `Atom<Result<Success, Error>>` |
| Mutation | `.mutate` | `AtomResultFn<Payload, Success, Error>` |
| Action | `.call` | `AtomResultFn<Payload, Success, Error>` |

### 2.4 Using Atoms in Components

#### Subscriptions (Real-time updates)

```typescript
"use client";
import { Result, useAtomValue } from "@effect-atom/atom-react";
import { Option } from "effect";
import { guestbookClient } from "@packages/ui/rpc/guestbook";

const entriesAtom = guestbookClient.list.subscription({});

export function GuestbookList() {
  const entriesResult = useAtomValue(entriesAtom);

  if (Result.isInitial(entriesResult)) {
    return <p>Loading...</p>;
  }
  
  if (Result.isFailure(entriesResult)) {
    return <p>Error loading entries</p>;
  }

  const entriesOption = Result.value(entriesResult);
  const entries = Option.isSome(entriesOption) ? entriesOption.value : [];
  
  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry._id}>{entry.name}: {entry.message}</li>
      ))}
    </ul>
  );
}
```

#### Mutations (One-shot operations)

```typescript
"use client";
import { Result, useAtom } from "@effect-atom/atom-react";
import { guestbookClient } from "@packages/ui/rpc/guestbook";

export function AddEntry() {
  const [addResult, addEntry] = useAtom(guestbookClient.add.mutate);
  const isSubmitting = Result.isWaiting(addResult);

  const handleSubmit = () => {
    addEntry({ name: "John", message: "Hello!" });
  };

  return (
    <button onClick={handleSubmit} disabled={isSubmitting}>
      {isSubmitting ? "Adding..." : "Add Entry"}
    </button>
  );
}
```

#### Pagination (Cursor-based loading)

```typescript
"use client";
import { usePaginatedAtom } from "@packages/ui/hooks/use-paginated-atom";
import { guestbookClient } from "@packages/ui/rpc/guestbook";

const PAGE_SIZE = 10;
const paginatedAtom = guestbookClient.listPaginated.paginated(PAGE_SIZE);

export function PaginatedList() {
  const { items, hasMore, isLoading, isInitial, loadMore } =
    usePaginatedAtom(paginatedAtom);

  if (isInitial) {
    return <button onClick={loadMore}>Start Loading</button>;
  }

  return (
    <div>
      <ul>
        {items.map((entry) => (
          <li key={entry._id}>{entry.name}: {entry.message}</li>
        ))}
      </ul>
      {hasMore && (
        <button onClick={loadMore} disabled={isLoading}>
          {isLoading ? "Loading..." : "Load More"}
        </button>
      )}
    </div>
  );
}
```

### 2.5 Result Type Helpers

```typescript
import { Result } from "@effect-atom/atom-react";
import { Option } from "effect";

// Check states
Result.isInitial(result)   // No data yet
Result.isWaiting(result)   // Loading/in-progress
Result.isSuccess(result)   // Has successful value
Result.isFailure(result)   // Has error

// Extract values
const valueOption = Result.value(result);  // Option<Success>
const errorOption = Result.error(result);  // Option<Error>

// Use with Option
if (Option.isSome(valueOption)) {
  console.log(valueOption.value);
}
```

---

## Common Patterns

### Error Handling with Tagged Errors

```typescript
class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { id: Schema.String },
) {}

class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  { field: Schema.String, message: Schema.String },
) {}

const endpoint = factory.mutation(
  {
    payload: { id: Schema.String },
    success: Schema.Struct({ ... }),
    error: Schema.Union(NotFoundError, ValidationError),
  },
  (args) =>
    Effect.gen(function* () {
      if (!args.id) {
        return yield* new ValidationError({ field: "id", message: "Required" });
      }
      // ...
    }),
);
```

### Defining Atoms at Module Level

```typescript
// Define atoms at module level, not inside components
const entriesAtom = guestbookClient.list.subscription({});
const paginatedAtom = guestbookClient.listPaginated.paginated(10);

export function MyComponent() {
  // Use atoms in components
  const result = useAtomValue(entriesAtom);
}
```

### Infinite Scroll with Sentinel

```typescript
import { useInfinitePagination } from "@packages/ui/hooks/use-paginated-atom";

const paginatedAtom = guestbookClient.listPaginated.paginated(20);

export function InfiniteList() {
  const { items, sentinelRef, isLoading } = useInfinitePagination(paginatedAtom);

  return (
    <div>
      {items.map((item) => <Item key={item._id} {...item} />)}
      <div ref={sentinelRef} /> {/* Triggers load when visible */}
      {isLoading && <Spinner />}
    </div>
  );
}
```

---

## Key Imports Reference

```typescript
// Backend (Convex functions)
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Cursor, PaginationOptionsSchema, PaginationResultSchema } from "@packages/confect";
import { ConfectQueryCtx, ConfectMutationCtx, confectSchema } from "../confect";
import { Effect, Schema } from "effect";

// Frontend (React)
import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { usePaginatedAtom, useInfinitePagination } from "@packages/ui/hooks/use-paginated-atom";
import { createRpcClient } from "@packages/confect/rpc";
import { Option } from "effect";
```
