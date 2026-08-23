# @agent-native/db-convex

Publishable Convex component for the agent-native **Convex** database dialect.

Apps keep using `@agent-native/core/db` (`createGetDb`, drizzle-shaped
`insert` / `select` / `update` / `delete`). Set `DATABASE_URL=convex:` and
mount this component; the Node client lives in `@agent-native/core` at
`packages/core/src/db/convex-db.ts`.

## Install

```bash
pnpm add @agent-native/db-convex convex
```

Peer-depends on `convex`.

## Enable the dialect

```bash
DATABASE_URL=convex:
CONVEX_URL=https://your-deployment.convex.cloud
```

`DATABASE_URL=convex:https://your-deployment.convex.cloud` also works. Opt in
with `DATABASE_URL` — `CONVEX_URL` alone does not switch dialects.

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

## Use createGetDb as usual

```ts
import { createGetDb } from "@agent-native/core/db";
import { table, text } from "@agent-native/core/db/schema";

const notes = table("notes", {
  id: text("id").primaryKey(),
  body: text("body").notNull(),
});

export const getDb = createGetDb({ notes });

const db = getDb();
await db.insert(notes).values({ id: "1", body: "hello" });
const rows = await db.select().from(notes);
```

### Supported

- `db.insert(table).values(...)`
- `db.select().from(table)` (optional `.where(eq(...))` / `.limit(n)`)
- `db.update(table).set(...).where(...)`
- `db.delete(table).where(...)`

### Not supported

These throw when the Convex dialect is active:

- `getDbExec` / raw SQL
- `runMigrations`
- `ensureAdditiveColumns`

Define tables in this component's schema (or extend it) instead of SQL
migrations.

## Layout

| Piece | Where |
| --- | --- |
| Dialect branch + Node client | `@agent-native/core` → `createGetDb` / `convex-db.ts` |
| Convex tables + mutations | this package (`convex.config.js`) |
