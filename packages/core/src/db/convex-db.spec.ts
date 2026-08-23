/** @vitest-environment edge-runtime */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One insert/read proof for the Convex dialect. Transport is convex-test on
 * `@agent-native/db-convex`'s component; createGetDb is the app-facing surface.
 */
describe("createGetDb Convex dialect", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "convex:");
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
});
