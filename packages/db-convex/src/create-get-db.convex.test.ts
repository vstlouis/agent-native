// Import via the package name so the test transport lands on the same module
// instance createGetDb dynamically imports.
import {
  createConvexDb,
  setConvexDbTestTransport,
  type ConvexDbTransport,
} from "@agent-native/db-convex";
import { convexTest } from "convex-test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Prove insert/query/update/delete through `@agent-native/core/db` against a
 * real Convex backend (convex-test running this package's component schema).
 *
 * kitcn's ORM inspired the Drizzle-shaped surface; it is not a dependency here
 * because it runs inside Convex functions, not as the Node `createGetDb` client.
 */
describe("createGetDb + Convex component", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "convex:");
    setConvexDbTestTransport(undefined);
  });

  afterEach(() => {
    setConvexDbTestTransport(undefined);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function makeTransport(t: ReturnType<typeof convexTest>): ConvexDbTransport {
    return {
      query: (fn, args) =>
        t.query(api.rows[fn], args) as Promise<Record<string, unknown>[]>,
      mutation: (fn, args) => t.mutation(api.rows[fn], args as never),
    };
  }

  it("inserts and queries a row through createGetDb", async () => {
    const t = convexTest(schema, modules);
    setConvexDbTestTransport(makeTransport(t));

    const { createGetDb } = await import("@agent-native/core/db");
    const { sqliteTable, text } = await import("drizzle-orm/sqlite-core");

    // Use drizzle sqlite builders so schema definition does not depend on
    // getDialect() caching from a prior SQL driver in this process.
    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      body: text("body").notNull(),
    });

    const getDb = createGetDb({ notes });
    const db = getDb();

    await db.insert(notes).values({
      id: "n1",
      body: "hello convex",
    });

    const rows = await db.select().from(notes);
    expect(rows).toEqual([{ id: "n1", body: "hello convex" }]);

    await db.update(notes).set({ body: "updated" }).where(eq(notes.id, "n1"));
    const updated = await db.select().from(notes).where(eq(notes.id, "n1"));
    expect(updated).toEqual([{ id: "n1", body: "updated" }]);

    await db.delete(notes).where(eq(notes.id, "n1"));
    const afterDelete = await db.select().from(notes);
    expect(afterDelete).toEqual([]);
  });

  it("createConvexDb supports CRUD without going through createGetDb", async () => {
    const t = convexTest(schema, modules);
    const { sqliteTable, text } = await import("drizzle-orm/sqlite-core");
    const items = sqliteTable("items", {
      id: text("id").primaryKey(),
      name: text("name").notNull(),
    });

    const db = createConvexDb({ transport: makeTransport(t) });
    await db.insert(items).values({ id: "1", name: "alpha" });
    const found = await db.select().from(items).where(eq(items.id, "1"));
    expect(found).toEqual([{ id: "1", name: "alpha" }]);
  });
});
