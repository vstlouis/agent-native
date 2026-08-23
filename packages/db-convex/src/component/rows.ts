import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";

function assertNonEmptyFilter(filter: Record<string, unknown>): void {
  if (Object.keys(filter).length === 0) {
    throw new Error(
      "Convex rows refuse an empty filter (Object.entries({}).every is vacuously true and would match every row).",
    );
  }
}

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

function toCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/** Match filter keys against row data under either JS or SQL spelling. */
function fieldEquals(
  data: Record<string, unknown> | undefined,
  key: string,
  value: unknown,
): boolean {
  if (!data) return false;
  const candidates = new Set<string>([key, toSnakeCase(key), toCamelCase(key)]);
  for (const candidate of candidates) {
    if (
      Object.prototype.hasOwnProperty.call(data, candidate) &&
      data[candidate] === value
    ) {
      return true;
    }
  }
  return false;
}

function rowMatchesFilter(
  data: Record<string, unknown> | undefined,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([key, value]) =>
    fieldEquals(data, key, value),
  );
}

export const insert = mutation({
  args: {
    tableName: v.string(),
    rowKey: v.string(),
    data: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rows")
      .withIndex("by_table_key", (q) =>
        q.eq("tableName", args.tableName).eq("rowKey", args.rowKey),
      )
      .unique();
    if (existing) {
      throw new Error(
        `Convex insert refused: row already exists for table "${args.tableName}" key "${args.rowKey}".`,
      );
    }
    await ctx.db.insert("rows", {
      tableName: args.tableName,
      rowKey: args.rowKey,
      data: args.data,
    });
    return null;
  },
});

export const list = query({
  args: {
    tableName: v.string(),
    filter: v.optional(v.record(v.string(), v.any())),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("rows")
      .withIndex("by_table", (q) => q.eq("tableName", args.tableName))
      .collect();
    if (args.filter !== undefined) {
      assertNonEmptyFilter(args.filter);
      const filter = args.filter;
      rows = rows.filter((row) => rowMatchesFilter(row.data, filter));
    }
    const docs = rows.map((row) => row.data);
    if (args.limit !== undefined) return docs.slice(0, args.limit);
    return docs;
  },
});

export const update = mutation({
  args: {
    tableName: v.string(),
    filter: v.record(v.string(), v.any()),
    patch: v.any(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertNonEmptyFilter(args.filter);
    const rows = await ctx.db
      .query("rows")
      .withIndex("by_table", (q) => q.eq("tableName", args.tableName))
      .collect();
    let updated = 0;
    for (const row of rows) {
      if (!rowMatchesFilter(row.data, args.filter)) continue;
      await ctx.db.patch(row._id, {
        data: { ...row.data, ...args.patch },
      });
      updated += 1;
    }
    return updated;
  },
});

export const remove = mutation({
  args: {
    tableName: v.string(),
    filter: v.record(v.string(), v.any()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertNonEmptyFilter(args.filter);
    const rows = await ctx.db
      .query("rows")
      .withIndex("by_table", (q) => q.eq("tableName", args.tableName))
      .collect();
    let removed = 0;
    for (const row of rows) {
      if (!rowMatchesFilter(row.data, args.filter)) continue;
      await ctx.db.delete(row._id);
      removed += 1;
    }
    return removed;
  },
});
