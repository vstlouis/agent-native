/** @vitest-environment edge-runtime */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One insert/read proof for the Convex dialect. Transport is convex-test on
 * `@agent-native/db-convex`'s component; createGetDb is the app-facing surface.
 */
describe("createGetDb Convex dialect", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "convex://");
  });

  afterEach(async () => {
    const { setConvexDbTestTransport } = await import("./convex-db.js");
    setConvexDbTestTransport(undefined);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("inserts and reads a row", async () => {
    const { convexTest } = await import("convex-test");
    const { api, modules, schema } =
      await import("@agent-native/db-convex/test");
    const { setConvexDbTestTransport } = await import("./convex-db.js");

    const t = convexTest(schema, modules);
    setConvexDbTestTransport({
      query: (fn, args) =>
        t.query(api.rows[fn], args) as Promise<Record<string, unknown>[]>,
      mutation: (fn, args) => t.mutation(api.rows[fn], args as never),
    });

    const { createGetDb } = await import("./create-get-db.js");
    const { sqliteTable, text } = await import("drizzle-orm/sqlite-core");
    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      body: text("body").notNull(),
    });

    const db = createGetDb({ notes })();
    await db.insert(notes).values({ id: "n1", body: "hello convex" });
    const rows = await db.select().from(notes);
    expect(rows).toEqual([{ id: "n1", body: "hello convex" }]);
  });

  it("throws on and() instead of keeping the first eq", async () => {
    const { parseWhereFilter } = await import("./convex-db.js");
    const { and, eq } = await import("drizzle-orm");
    const { sqliteTable, text, integer } =
      await import("drizzle-orm/sqlite-core");
    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      n: integer("n"),
    });
    expect(() =>
      parseWhereFilter(and(eq(notes.id, "x"), eq(notes.n, 1))),
    ).toThrow(/and\/or\/not|eq\(column, value\)/);
  });

  it("throws on an empty object filter", async () => {
    const { parseWhereFilter } = await import("./convex-db.js");
    expect(() => parseWhereFilter({})).toThrow(/non-empty filter|empty object/);
  });

  it("throws on unsupported select builder methods", async () => {
    const { createConvexDb, setConvexDbTestTransport } =
      await import("./convex-db.js");
    setConvexDbTestTransport({
      query: async () => [],
      mutation: async () => null,
    });
    const { sqliteTable, text } = await import("drizzle-orm/sqlite-core");
    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      body: text("body"),
    });
    const db = createConvexDb();
    const q = db.select().from(notes) as { orderBy: () => unknown };
    expect(() => q.orderBy()).toThrow(/orderBy|does not support/);
    expect(() =>
      (
        db.insert(notes) as { onConflictDoNothing: () => unknown }
      ).onConflictDoNothing(),
    ).toThrow(/onConflict|does not support/);
  });

  it("refuses duplicate insert for the same table key", async () => {
    const { convexTest } = await import("convex-test");
    const { api, modules, schema } =
      await import("@agent-native/db-convex/test");
    const { createConvexDb, setConvexDbTestTransport } =
      await import("./convex-db.js");

    const t = convexTest(schema, modules);
    setConvexDbTestTransport({
      query: (fn, args) =>
        t.query(api.rows[fn], args) as Promise<Record<string, unknown>[]>,
      mutation: (fn, args) => t.mutation(api.rows[fn], args as never),
    });

    const { sqliteTable, text } = await import("drizzle-orm/sqlite-core");
    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      body: text("body").notNull(),
    });
    const db = createConvexDb();
    await db.insert(notes).values({ id: "n1", body: "one" });
    await expect(
      db.insert(notes).values({ id: "n1", body: "two" }),
    ).rejects.toThrow(/already exists/);
  });

  it("matches eq(jsKey) against snake_case stored fields", async () => {
    const { convexTest } = await import("convex-test");
    const { api, modules, schema } =
      await import("@agent-native/db-convex/test");
    const { setConvexDbTestTransport, parseWhereFilter } =
      await import("./convex-db.js");
    const { eq } = await import("drizzle-orm");
    const { sqliteTable, text } = await import("drizzle-orm/sqlite-core");

    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      ownerEmail: text("owner_email"),
    });
    const filter = parseWhereFilter(eq(notes.ownerEmail, "a@b.c"));
    expect(filter).toMatchObject({ ownerEmail: "a@b.c" });
    expect(filter.owner_email).toBe("a@b.c");

    const t = convexTest(schema, modules);
    setConvexDbTestTransport({
      query: (fn, args) =>
        t.query(api.rows[fn], args) as Promise<Record<string, unknown>[]>,
      mutation: (fn, args) => t.mutation(api.rows[fn], args as never),
    });
    await t.mutation(api.rows.insert, {
      tableName: "notes",
      rowKey: "1",
      data: { id: "1", owner_email: "a@b.c" },
    });
    const rows = await t.query(api.rows.list, {
      tableName: "notes",
      filter,
    });
    expect(rows).toEqual([{ id: "1", owner_email: "a@b.c" }]);
  });
});

describe("@agent-native/core/db public entry", () => {
  it("does not statically re-export createConvexDb", async () => {
    vi.resetModules();
    const mod = await import("./index.js");
    expect(mod.createGetDb).toBeTypeOf("function");
    expect(
      (mod as { createConvexDb?: unknown }).createConvexDb,
    ).toBeUndefined();
  });
});
