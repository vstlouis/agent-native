import {
  setConvexDbTestTransport,
  type ConvexDbTransport,
} from "@agent-native/db-convex";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

describe("createGetDb Convex path", () => {
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

  it("inserts and reads a row through createGetDb", async () => {
    const t = convexTest(schema, modules);
    const transport: ConvexDbTransport = {
      query: (fn, args) =>
        t.query(api.rows[fn], args) as Promise<Record<string, unknown>[]>,
      mutation: (fn, args) => t.mutation(api.rows[fn], args as never),
    };
    setConvexDbTestTransport(transport);

    const { createGetDb } = await import("@agent-native/core/db");
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
