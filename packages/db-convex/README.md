# @agent-native/db-convex

Publishable Convex **component** (tables + mutations) for the agent-native
Convex database dialect spike.

The Node-side drizzle-shaped client lives in `@agent-native/core` at
`packages/core/src/db/convex-db.ts` and is loaded only via a **dynamic** import
inside `createGetDb` when `DATABASE_URL` selects the convex dialect. It is not
a static re-export of `@agent-native/core/db`.

## What actually works

With a **host-provided transport** or the **test transport**
(`setConvexDbTestTransport` + convex-test against this component):

- `createGetDb({ ... })()` → `insert` / `select` / `update` / `delete`
- `where()` with a **single** `eq(column, value)` (or a plain `{ column: value }`
  object). `and` / `or` / `gt` / `neq` / composites **throw** — they are not
  silently reduced to the first `eq`.

There is **no** default Node HTTP path. `ConvexHttpClient` cannot call internal
component function refs from Node; without an injected transport, `createConvexDb`
throws a precise error.

## What does not work

These are out of scope for this spike (and throw or are unsupported):

- Boot plugins / a full running agent-native app on Convex
- `getDbExec` / raw SQL
- `runMigrations` / `ensureAdditiveColumns`
- Better Auth (convex dialect fails loudly in `buildDatabaseConfig`)
- Agent `db-*` tools that assume SQL
- Templates / SQL migrations

Define rows in this component's schema (or extend it) instead of SQL migrations.

## Install

```bash
pnpm add @agent-native/db-convex convex
```

Peer-depends on `convex`.

## Enable the dialect

```bash
DATABASE_URL=convex:
```

`DATABASE_URL=convex:https://….convex.cloud` also selects the dialect.
`CONVEX_URL` alone does **not** switch dialects.

Selecting the dialect alone is not enough to talk to a deployment — you still
need a host-injected transport that calls this component.

## Register the component

In your app's `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import agentNativeDb from "@agent-native/db-convex/convex.config.js";

const app = defineApp();
app.use(agentNativeDb);
export default app;
```

Then run `npx convex dev` so the component deploys with your app.

## Spike usage (transport required)

```ts
import { createGetDb } from "@agent-native/core/db";
import { eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  body: text("body").notNull(),
});

// Host must inject a transport that calls this component's rows API.
// In vitest, see packages/core/src/db/convex-db.spec.ts (convex-test).
export const getDb = createGetDb({ notes });

const db = getDb();
await db.insert(notes).values({ id: "1", body: "hello" });
const rows = await db.select().from(notes).where(eq(notes.id, "1"));
```

## Layout

| Piece | Where |
| --- | --- |
| Dialect branch + Node client (dynamic import only) | `@agent-native/core` → `createGetDb` / `convex-db.ts` |
| Convex tables + mutations | this package (`convex.config.js`) |
