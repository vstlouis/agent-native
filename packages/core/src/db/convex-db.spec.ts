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
